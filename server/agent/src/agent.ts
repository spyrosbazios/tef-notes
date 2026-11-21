// POST /agent/chat: one turn of the agent loop (model call → tool → model, up to the effort's steps, @/core/agent EFFORT; what changes between steps: loop.ts), streamed back as the AI
// SDK's UI message stream, so a client is useChat + DefaultChatTransport({ api: "/agent/chat" }). Note writes ask
// through the SDK's tool approval: the confirm card comes back as an approval-requested part, the client's answer
// as an approval-responded one on the next request, which runs it. The chat is saved to `chats` every few seconds
// and when the turn ends, stopped and failed ones too.
// An assistant client sends `context` (what is on screen, packages/core/src/assistant.ts): it ends the newest message's
// <context>, and the tools the app does itself (open_note …, no `execute`) are offered. Such a call ends the turn
// until the client answers it with addToolOutput and resends.
// While a turn runs, the owner can steer it (steer.ts): their message joins the turn at the next step boundary.
// A note action's run (note-action.ts) sends `action`: the turn is narrowed to what that action may do.
import { ChatHistoryError, readChatHistory } from "@/core/chat-history";
import { allowed, policyApprovals } from "./tool-policy";
import {
  createAgentUIStream, createUIMessageStreamResponse, generateId, readUIMessageStream, isStepCount, smoothStream, ToolLoopAgent,
  type InferUITools, type ModelMessage, type UIMessage,
} from "ai";
import { z } from "zod";
import type { Actions } from "@/core/actions";
import { EFFORT, EFFORTS, type Effort } from "@/core/agent";
import { attachedBlock, attachedFiles, hasAttachment, type Attached, uiToolsFor, UI_TOOL_NAMES, type AssistantContext } from "@/core/assistant";
import { runOf } from "@/core/note-actions";
import { MEMORY, parseNote } from "@/core/notes";
import type { Server } from "@/core/pocketbase";
import { exists, saver } from "./chats";
import { Context, screen } from "./assistant";
import { historyFromWeb, repair, settle, withContext } from "./guard";
import { key } from "./keys";
import { approvalSecret } from "./approval-secret";
import { lastStep, stepTools, trim } from "./loop";
import { steeringFor } from "./steer";
import { instructions as runInstructions, offeredTo, scoped, scopeOf, type Scope } from "./note-action";
import { Notes } from "./notes";
import { Todo } from "./todo";
import { model, sees, Unavailable } from "./models";
import { ownerPrefs } from "./prefs";
import { withoutPictures } from "./drawings";
import { inlinePdfs, preview } from "./pdfs";
import { PLACES, SYSTEM, today, WEB } from "./systemPrompt";
import { noteIndex, readWeb, tools, toolPolicies, policyFor, type Tools } from "./tools";

/** A message as useChat holds it, tool parts typed: what `chats.messages` holds. */
export type AgentMessage = UIMessage<unknown, never, InferUITools<Tools>>;

const SAVE_EVERY = 3000;

const Body = z.object({
  id: z.string().min(1).max(64),
  messages: z.array(z.unknown()),
  model: z.string().min(1).max(200),
  effort: z.enum(EFFORTS),
  context: Context,                     // the page the assistant is on; absent or unreadable: a plain chat
  action: z.unknown().transform(runOf).optional(),  // a note action's run (note-action.ts); absent or unreadable: a plain chat
});

/** The date, memory, the notes index and what is on the owner's screen (and the first pages of the open note's PDFs):
 *  they change from one message to the next, so they ride on the newest user message (withContext), not in the
 *  instructions — those stay byte for byte the same, the prompt cache's prefix. The live screen comes last: it changes
 *  most. `foreign`: whether someone else's text is in it, which taints the turn (approvals): a PDF's, or words selected
 *  in an open note a chat that read the web wrote (its `tainted` column: the selection is that note's text, read back). */
export async function context(notes: Notes, page: AssistantContext | undefined, files: readonly Attached[] = []) {
  const memory = (await notes.meta(MEMORY))?.text.trim() || "(empty)";
  const open = page?.note && await notes.meta(page.note.path);
  const pdfs = open ? await preview(notes.server, { id: parseNote(open.path, open.text).id, path: open.path }) : "";
  const shown = [screen(page), pdfs, attachedBlock(files)].filter(Boolean).join("\n\n");
  return {
    text: `<context>\n${today()}\n\n<file path="${MEMORY}">\n${memory}\n</file>\n\n<notes>\n${noteIndex(await notes.list())}\n</notes>${shown && `\n\n${shown}`}\n</context>`,
    // A drawing open in the editor is its note's: shown from a note a chat that read the web wrote, it is that text again
    foreign: !!pdfs || (!!page?.selection && !!open?.tainted) || (!!page?.drawing && !!(await notes.meta(page.drawing.path))?.tainted),
  };
}

/** Notes and tasks are the user's: each write asks, goes ahead or is refused by the owner's rule for its action (`rules`, their
 *  preferences' `actions`, @/core/actions), and one allowed without asking still asks once the chat has read the web or a PDF
 *  (`web`), where a page can carry instructions aimed at the agent. A bad path skips the card: the tool's error goes straight back. */
export function approvals(notes: Notes, todo: Todo, rules: Actions, web = readWeb(notes, todo), files: readonly Attached[] = []) {
  return policyApprovals(toolPolicies(), { notes, todo, files }, rules, web);
}

/** What `approvals` is told about the turn's taint: the taint itself while the owner's web guard is on (prefs
 *  `agent.webGuard`), never when they turned it off. Off changes only the cards: writes are still marked `tainted`, and
 *  memory and the selection tools are still withdrawn (loop.ts `stepTools`). */
export const guarded = (webGuard: boolean, untrusted: (ms: ModelMessage[]) => Promise<boolean>) =>
  webGuard ? untrusted : async () => false;

/** `foreign`: someone else's text is in this turn's context (`context`), or the owner attached a file to the chat: its writes are tainted and ask, like after reading the web. */
async function build(notes: Notes, todo: Todo, pick: typeof model, id: string, rules: Actions, webGuard: boolean, effort: Effort, page: AssistantContext | undefined, foreign: boolean, files: readonly Attached[], scope?: Scope) {
  const { model: m, providerOptions } = await pick(id);
  const { steps, reasoning } = EFFORT[effort];
  const read = readWeb(notes, todo), untrusted = foreign ? async () => true : read;
  const web = !!(await key("exa")), all = tools(notes, todo, untrusted, files);
  // Out of the prompt: the web tools without an Exa key, the tools the client does itself unless this page can do them,
  // the writes the owner never allows (a call made anyway is refused by toolApproval), and in a note action's run all but
  // the tools that action needs
  const ui = uiToolsFor(page), off = new Set<string>(UI_TOOL_NAMES.filter((n) => !ui.includes(n)));
  const base = (Object.keys(all) as (keyof Tools)[])
    .filter((n) => !off.has(n) && (web || !policyFor(n)?.requiresExa) && allowed(policyFor(n), rules) && (!scope || offeredTo(scope, n)));
  const gate = approvals(notes, todo, rules, guarded(webGuard, untrusted), files);
  return new ToolLoopAgent({
    model: m,
    instructions: `${SYSTEM}\n${PLACES}${web ? `\n${WEB}` : ""}${scope ? `\n\n${runInstructions(scope)}` : ""}`,
    tools: all,
    stopWhen: isStepCount(steps),
    reasoning,
    // Per step: the first trims earlier turns' bulky results (loop.ts), every one picks its tools, and the last has to
    // answer, or a tool call there ends the turn with no reply
    prepareStep: async ({ stepNumber, messages }) => ({
      ...(stepNumber === 0 && { messages: trim(messages) }),
      ...(stepNumber < steps - 1 ? { activeTools: stepTools(base, await untrusted(messages), policyFor) } : lastStep()),
    }),
    toolApproval: scope ? scoped(gate, scope) : gate,
    // A card's answer runs its write only if this server issued the card (approval-secret.ts)
    experimental_toolApprovalSecret: await approvalSecret(),
    providerOptions,
  });
}

const fail = (status: number, message: string) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/** `pick`: the model for the request's id; the tests hand in a mock. */
export async function chat(req: Request, server: Server, pick: typeof model = model): Promise<Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, `Bad request: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  const { id, model: picked, effort, context: page } = parsed.data;
  let history: AgentMessage[];
  try {
    if (!(await exists(server, id))) return fail(404, `No chat ${id}: create it in chats first.`);
    history = settle(readChatHistory({ messages: parsed.data.messages }) as AgentMessage[]);
  } catch (e) {
    if (e instanceof ChatHistoryError) return fail(400, e.message);
    throw e;
  }

  const files = attachedFiles(parsed.data.messages as AgentMessage[]);
  const notes = new Notes(server), todo = new Todo(server), ctx = await context(notes, page, files);
  // Classify before schema repair: an obsolete input must never erase a past untrusted read.
  const historicalTaint = historyFromWeb(history, new Set([...(await notes.tainted()), ...(await todo.tainted())]), policyFor);
  let agent: ToolLoopAgent<never, Tools>;
  // The owner's rules are read here, never taken from the request: no client can turn a card off
  const { actions: rules, agent: { webGuard }, noteActions } = (await ownerPrefs(server)).prefs;
  // A run's action is the owner's saved one, read here like the rules: a request names it and can't describe it
  const run = parsed.data.action, scope = run && scopeOf(run, noteActions);
  if (run && !scope) return fail(400, `No note action ${run.id}: it was deleted.`);
  try { agent = await build(notes, todo, pick, picked, rules, webGuard, effort, page, ctx.foreign || historicalTaint || hasAttachment(parsed.data.messages as AgentMessage[]), files, scope); } catch (e) {
    if (e instanceof Unavailable) return fail(400, e.message);
    throw e;
  }
  let messages: AgentMessage[];
  try {
    // settle: a turn stopped mid-tool, a card passed over. repair: chats saved before a tool's schema changed
    messages = await repair(history, agent.tools);
    if (!sees(picked)) messages = withoutPictures(messages);
  } catch (e) {
    return fail(400, `Bad messages: ${(e as Error).message}`);
  }

  // A saved chat holds no picture bytes: a draw's picture is for the turn it was drawn in (drawings.ts)
  const keep = saver(server, id, picked), save = (ms: AgentMessage[]) => keep(withoutPictures(ms));
  const { steering, done } = steeringFor(id);
  let stream: ReadableStream<any>;
  try {
    stream = await createAgentUIStream({
      agent,
      uiMessages: withContext(await inlinePdfs(messages), ctx.text),
      originalMessages: history,
      generateMessageId: generateId,
      abortSignal: req.signal,
      experimental_steering: steering,              // the client's Stop (or a dropped connection) ends the turn
      // Providers send text in bursts; re-chunk it word by word so the answer arrives at an even pace (~50 words/s)
      experimental_transform: smoothStream({ delayInMs: 20 }),
      onEnd: ({ messages: all }) => save(all),
      onError: (e) => (e instanceof Error ? e.message : String(e)),
    });
  } catch (e) {
    done();
    return fail(400, `Bad messages: ${(e as Error).message}`);
  }

  // A copy of the stream builds the reply as the client sees it, saved every few seconds while it runs
  const [out, copy] = stream.tee();
  const last = history.at(-1), continued = last?.role === "assistant";
  const before = continued ? history.slice(0, -1) : history;
  void (async () => {
    let at = Date.now();
    try {
      for await (const m of readUIMessageStream<AgentMessage>({ message: continued ? last : undefined, stream: copy })) {
        if (Date.now() - at < SAVE_EVERY) continue;
        at = Date.now();
        save([...before, m]);
      }
    } catch { /* the final save (onEnd) has it */ } finally { done(); }
  })();
  return createUIMessageStreamResponse({ stream: out, keepAliveMs: 15_000 });
}
