// POST /agent/chat: one turn of the agent loop (model call → tool → model, up to the effort's steps, @/core/agent EFFORT; what changes between steps: loop.ts), streamed back as the AI
// SDK's UI message stream, so a client is useChat + DefaultChatTransport({ api: "/agent/chat" }). Note writes ask
// through the SDK's tool approval: the confirm card comes back as an approval-requested part, the client's answer
// as an approval-responded one on the next request, which runs it. The chat is saved to `chats` every few seconds
// and when the turn ends, stopped and failed ones too.
// An assistant client sends `context` (what is on screen, packages/core/src/assistant.ts): it ends the newest message's
// <context>, and the tools the app does itself (open_note …, no `execute`) are offered. Such a call ends the turn
// until the client answers it with addToolOutput and resends.
import {
  createAgentUIStream, createUIMessageStreamResponse, generateId, readUIMessageStream, isStepCount, smoothStream, ToolLoopAgent,
  type InferUITools, type ModelMessage, type UIMessage,
} from "ai";
import { lensFields, type LensInput } from "./widgetTools";
import { z } from "zod";
import { EFFORT, EFFORTS, type Effort } from "@/core/agent";
import { hasAttachment, uiToolsFor, UI_TOOL_NAMES, type AssistantContext } from "@/core/assistant";
import { MEMORY, parseNote } from "@/core/notes";
import type { Server } from "@/core/pocketbase";
import { exists, saver } from "./chats";
import { Context, screen } from "./assistant";
import { repair, settle, WEB_TOOLS, withContext } from "./guard";
import { key } from "./keys";
import { stepTools, trim } from "./loop";
import { Notes } from "./notes";
import { Todo } from "./todo";
import { model, Unavailable } from "./models";
import { inlinePdfs, preview } from "./pdfs";
import { PLACE_SEARCH, placeInputProblem } from "./placeTools";
import { PLACES, SYSTEM, today, WEB } from "./systemPrompt";
import { CAP, checkWrite, noteIndex, readWeb, tools, type Tools } from "./tools";
import { checkAdd, checkAddMany, checkTask, checkUpdate, type AddInput, type AddManyInput, type UpdateInput } from "./todoTools";

/** A message as useChat holds it, tool parts typed: what `chats.messages` holds. */
export type AgentMessage = UIMessage<unknown, never, InferUITools<Tools>>;

const SAVE_EVERY = 3000;

const Body = z.object({
  id: z.string().min(1).max(64),
  messages: z.array(z.unknown()),
  model: z.string().min(1).max(200),
  writesWithoutAsking: z.boolean(),
  effort: z.enum(EFFORTS),
  context: Context,                     // the page the assistant is on; absent or unreadable: a plain chat
});

/** The date, memory, the notes index and what is on the owner's screen (and the first pages of the open note's PDFs):
 *  they change from one message to the next, so they ride on the newest user message (withContext), not in the
 *  instructions — those stay byte for byte the same, the prompt cache's prefix. The live screen comes last: it changes
 *  most. `pdfs`: whether a PDF's text is in it, which taints the turn (approvals). */
async function context(notes: Notes, page: AssistantContext | undefined) {
  const memory = (await notes.meta(MEMORY))?.text.trim() || "(empty)";
  const open = page?.note && await notes.meta(page.note.path);
  const pdfs = open ? await preview(notes.server, { id: parseNote(open.path, open.text).id, path: open.path }) : "";
  const shown = [screen(page), pdfs].filter(Boolean).join("\n\n");
  return {
    text: `<context>\n${today()}\n\n<file path="${MEMORY}">\n${memory}\n</file>\n\n<notes>\n${noteIndex(await notes.list())}\n</notes>${shown && `\n\n${shown}`}\n</context>`,
    pdfs: !!pdfs,
  };
}

/** Notes are the user's: a write shows a confirm card, unless they turned that off in Settings — and even then once
 *  the chat has read the web or a PDF (`web`), where a page can carry instructions aimed at the agent. A bad path skips
 *  the card: the tool's error goes straight back to the agent. */
export function approvals(notes: Notes, todo: Todo, writesWithoutAsking: boolean, web = readWeb(notes, todo)) {
  const ask = async (messages: ModelMessage[], bad: Promise<string | null> | null = null) =>
    (await bad) || (writesWithoutAsking && !(await web(messages))) ? "not-applicable" as const : "user-approval" as const;
  type O = { messages: ModelMessage[] };
  return {
    create_tag: (_: unknown, { messages }: O) => ask(messages),
    // a lens is checked first, like a path: a bad tag goes straight back
    create_lens: (i: LensInput, { messages }: O) => ask(messages, lensFields(notes, i).then((f) => ("error" in f ? f.error : null))),
    update_tag: (_: unknown, { messages }: O) => ask(messages),
    create_note: (_: unknown, { messages }: O) => ask(messages),
    append_to_note: ({ path }: { path: string }, { messages }: O) => ask(messages, checkWrite(notes, path)),
    rewrite_note: ({ path, text }: { path: string; text: string }, { messages }: O) => ask(messages, checkWrite(notes, path, text)),
    summarise_links: ({ path }: { path: string }, { messages }: O) => ask(messages, checkWrite(notes, path)),
    set_note_flags: ({ path }: { path: string }, { messages }: O) => ask(messages, checkWrite(notes, path)),
    set_note_place: (i: { path: string; place_id?: string; name?: string; clear?: boolean }, { messages }: O) =>
      ask(messages, Promise.resolve(placeInputProblem(i)).then((p) => p ?? checkWrite(notes, i.path))),
    // a delete has no way back: it asks whatever the setting, unless the path is bad
    delete_note: async ({ path }: { path: string }) => ((await checkWrite(notes, path)) ? "not-applicable" as const : "user-approval" as const),
    // tasks are records: the task, note and every value are checked first, like a path
    add_task: (i: AddInput, { messages }: O) => ask(messages, checkAdd(notes, todo, i)),
    add_tasks: (i: AddManyInput, { messages }: O) => ask(messages, checkAddMany(notes, todo, i)),
    update_task: (i: UpdateInput, { messages }: O) => ask(messages, checkUpdate(notes, todo, i)),
    complete_task: ({ id }: { id: string }, { messages }: O) => ask(messages, checkTask(todo, id)),
    // a delete has no way back: it asks whatever the setting, unless the id is bad
    delete_task: async ({ id }: { id: string }) => ((await checkTask(todo, id)) ? "not-applicable" as const : "user-approval" as const),
    // memory is the agent's, unless a web page could be steering it. Too long goes straight back to the agent
    update_memory: async ({ text }: { text: string }, { messages }: O) =>
      (text.length <= CAP && await web(messages) ? "user-approval" as const : "not-applicable" as const),
  };
}

/** `pdfs`: a PDF's text is in this turn's context, or the owner attached a file to the chat: its writes are tainted and ask, like after reading the web. */
async function build(notes: Notes, todo: Todo, pick: typeof model, id: string, writesWithoutAsking: boolean, effort: Effort, page: AssistantContext | undefined, pdfs: boolean) {
  const { model: m, providerOptions } = await pick(id);
  const { steps, reasoning } = EFFORT[effort];
  const read = readWeb(notes, todo), untrusted = pdfs ? async () => true : read;
  const web = !!(await key("exa")), maps = !!(await key("maps")), all = tools(notes, todo, untrusted);
  // Out of the prompt: the web tools without an Exa key, place search without a Maps key, and the tools the client does
  // itself unless this page can do them
  const ui = uiToolsFor(page), off = new Set<string>([...(web ? [] : WEB_TOOLS), ...(maps ? [] : [PLACE_SEARCH]), ...UI_TOOL_NAMES.filter((n) => !ui.includes(n))]);
  const base = (Object.keys(all) as (keyof Tools)[]).filter((n) => !off.has(n));
  return new ToolLoopAgent({
    model: m,
    instructions: `${SYSTEM}${maps ? `\n${PLACES}` : ""}${web ? `\n${WEB}` : ""}`,
    tools: all,
    stopWhen: isStepCount(steps),
    reasoning,
    // Per step: the first trims earlier turns' bulky results (loop.ts), every one picks its tools, and the last has to
    // answer, or a tool call there ends the turn with no reply
    prepareStep: async ({ stepNumber, messages }) => ({
      ...(stepNumber === 0 && { messages: trim(messages) }),
      ...(stepNumber < steps - 1 ? { activeTools: stepTools(base, await untrusted(messages)) } : { toolChoice: "none" as const }),
    }),
    toolApproval: approvals(notes, todo, writesWithoutAsking, untrusted),
    providerOptions,
  });
}

const fail = (status: number, message: string) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/** `pick`: the model for the request's id; the tests hand in a mock. */
export async function chat(req: Request, server: Server, pick: typeof model = model): Promise<Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, `Bad request: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  const { id, model: picked, writesWithoutAsking, effort, context: page } = parsed.data;
  if (!(await exists(server, id))) return fail(404, `No chat ${id}: create it in chats first.`);

  const notes = new Notes(server), todo = new Todo(server), ctx = await context(notes, page);
  let agent: ToolLoopAgent<never, Tools>;
  try { agent = await build(notes, todo, pick, picked, writesWithoutAsking, effort, page, ctx.pdfs || hasAttachment(parsed.data.messages as AgentMessage[])); } catch (e) {
    if (e instanceof Unavailable) return fail(400, e.message);
    throw e;
  }
  let messages: AgentMessage[];
  try {
    // settle: a turn stopped mid-tool, a card passed over. repair: chats saved before a tool's schema changed
    messages = await repair(settle(parsed.data.messages as AgentMessage[]), agent.tools);
  } catch (e) {
    return fail(400, `Bad messages: ${(e as Error).message}`);
  }

  const save = saver(server, id, picked);
  let stream: ReadableStream<any>;
  try {
    stream = await createAgentUIStream({
      agent,
      uiMessages: withContext(await inlinePdfs(messages), ctx.text),
      originalMessages: messages,
      generateMessageId: generateId,
      abortSignal: req.signal,              // the client's Stop (or a dropped connection) ends the turn
      // Providers send text in bursts; re-chunk it word by word so the answer arrives at an even pace (~50 words/s)
      experimental_transform: smoothStream({ delayInMs: 20 }),
      onEnd: ({ messages: all }) => save(all),
      onError: (e) => (e instanceof Error ? e.message : String(e)),
    });
  } catch (e) {
    return fail(400, `Bad messages: ${(e as Error).message}`);
  }

  // A copy of the stream builds the reply as the client sees it, saved every few seconds while it runs
  const [out, copy] = stream.tee();
  const last = messages.at(-1), continued = last?.role === "assistant";
  const before = continued ? messages.slice(0, -1) : messages;
  void (async () => {
    let at = Date.now();
    try {
      for await (const m of readUIMessageStream<AgentMessage>({ message: continued ? last : undefined, stream: copy })) {
        if (Date.now() - at < SAVE_EVERY) continue;
        at = Date.now();
        save([...before, m]);
      }
    } catch { /* the final save (onEnd) has it */ }
  })();
  return createUIMessageStreamResponse({ stream: out, keepAliveMs: 15_000 });
}
