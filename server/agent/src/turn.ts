// One turn of the agent, for every way the owner talks to it: the chat (agent.ts, over HTTP) and Talk (talk.ts, over a
// WebSocket). The AI SDK's agent loop (model call → tool → model, up to the effort's steps, @/core/agent EFFORT; what
// changes between steps: loop.ts) streamed as the SDK's UI message stream. Everything that decides what the agent may do
// is here, once, and read for every turn: the owner's rules for its writes and their web guard (their preferences, never a
// request's), whether the conversation has read someone else's text (its history's tool parts, and the notes and tasks a
// tainted chat wrote, read fresh from the server), the confirm cards (tool approvals, signed: approval-secret.ts), the
// tools a step is offered, and how long the model may take.
// A turn ends on a card or on a tool the app does itself (no `execute`): the caller answers it in the history (an
// `approval-responded` part, or an `output-available` one) and runs the next turn, which picks up where this one stopped.
import {
  createAgentUIStream, generateId, isStepCount, smoothStream, ToolLoopAgent,
  type Experimental_Steering as Steering, type InferUITools, type ModelMessage, type UIMessage, type UIMessageChunk,
} from "ai";
import type { Actions } from "@/core/actions";
import { EFFORT, type Effort } from "@/core/agent";
import { attachedBlock, attachedFiles, hasAttachment, type Attached, uiToolsFor, UI_TOOL_NAMES, type AssistantContext } from "@/core/assistant";
import type { Run } from "@/core/note-actions";
import { MEMORY, parseNote } from "@/core/notes";
import type { Server } from "@/core/pocketbase";
import { allowed, policyApprovals } from "./tool-policy";
import { screen } from "./assistant";
import { historyFromWeb, repair, withContext } from "./guard";
import { key } from "./keys";
import { approvalSecret } from "./approval-secret";
import { lastStep, stepTools, trim } from "./loop";
import { instructions as runInstructions, offeredTo, scoped, scopeOf, type Scope } from "./note-action";
import { NoteService } from "./application/notes";
import { TaskService } from "./application/todo";
import { model as pickModel, sees, Unavailable } from "./models";
import { ownerPrefs } from "./prefs";
import { withoutPictures } from "./drawings";
import { inlinePdfs, preview } from "./pdfs";
import { PLACES, SYSTEM, TALK, today, WEB } from "./systemPrompt";
import { noteIndex } from "./notes";
import { readWeb, tools, toolPolicies, policyFor, type Tools } from "./tools";

/** A message as useChat holds it, tool parts typed: what `chats.messages` holds. */
export type AgentMessage = UIMessage<unknown, never, InferUITools<Tools>>;

/** How long the model may keep a turn waiting (the AI SDK's `timeout`): for its first output of a step (a reasoning model
 *  thinks first, and its thinking counts as output), and between one piece of output and the next. A provider that stops
 *  answering mid-stream ends the turn with an error instead of holding it, and a spoken conversation's paid ear, open. Tools
 *  have their own limits (pdfs.ts, reader.ts, the link-preview guard). */
export const MODEL_TIMEOUT = { firstChunkMs: 120_000, chunkMs: 60_000 } as const;

/** The date, memory, the notes index and what is on the owner's screen (and the first pages of the open note's PDFs):
 *  they change from one message to the next, so they ride on the newest user message (withContext), not in the
 *  instructions — those stay byte for byte the same, the prompt cache's prefix. The live screen comes last: it changes
 *  most. `foreign`: whether someone else's text is in it, which taints the turn (approvals): a PDF's, or words selected
 *  in an open note a chat that read the web wrote (its `tainted` column: the selection is that note's text, read back). */
export async function context(notes: NoteService, page: AssistantContext | undefined, files: readonly Attached[] = []) {
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
 *  (`web`), where a page can carry instructions aimed at the agent. A call its check fails (a bad path) is refused with the reason. */
export function approvals(notes: NoteService, todo: TaskService, rules: Actions, web = readWeb(notes, todo), files: readonly Attached[] = []) {
  return policyApprovals(toolPolicies(), { notes, todo, files }, rules, web);
}

/** What `approvals` is told about the turn's taint: the taint itself while the owner's web guard is on (prefs
 *  `agent.webGuard`), never when they turned it off. Off changes only the cards: writes are still marked `tainted`, and
 *  memory and the selection tools are still withdrawn (loop.ts `stepTools`). */
export const guarded = (webGuard: boolean, untrusted: (ms: ModelMessage[]) => Promise<boolean>) =>
  webGuard ? untrusted : async () => false;

/** What a turn is asked to do. */
export type TurnRequest = {
  server: Server;
  /** The model for an id: models.ts, or a mock in the tests. */
  pick?: typeof pickModel;
  model: string;
  effort: Effort;
  /** What is on the owner's screen (core/assistant.ts); absent: a plain chat. */
  page: AssistantContext | undefined;
  /** The conversation as it stands, settled (guard.ts): it ends on the owner's message, or on the reply a card or the app's
   *  answer continues. */
  history: AgentMessage[];
  /** A note action's run (note-action.ts): the turn is narrowed to what that action may do. */
  action?: Run;
  /** A spoken conversation (Talk): its instructions after the chat's, and none of the tools it has no screen for. */
  spoken?: boolean;
  abortSignal: AbortSignal;
  /** The owner's messages joining the turn at a step boundary (steer.ts). */
  steering?: Steering;
  /** Text re-chunked word by word, so a chat's answer arrives at an even pace. */
  smooth?: boolean;
  /** The whole conversation once the turn ends, however it ends: the chat saves it. */
  onEnd?: (messages: AgentMessage[]) => void;
};

/** A turn under way, or why it can't start (the caller's 400). */
export type Turn = { stream: ReadableStream<UIMessageChunk> } | { error: string };

/** Starts one turn of `r.history`. The owner's rules, web guard and note actions are read now, from their preferences. */
export async function runTurn(r: TurnRequest): Promise<Turn> {
  const notes = new NoteService(r.server), todo = new TaskService(r.server), files = attachedFiles(r.history);
  const ctx = await context(notes, r.page, files);
  // Classify before schema repair: an obsolete input must never erase a past untrusted read. The taint marks are read fresh
  // for every turn (a note a chat that read the web wrote since this conversation began counts)
  const historical = historyFromWeb(r.history, new Set([...(await notes.tainted()), ...(await todo.tainted())]), policyFor);
  // The owner's rules are read here, never taken from the request: no client can turn a card off
  const { actions: rules, agent: { webGuard }, noteActions } = (await ownerPrefs(r.server)).prefs;
  // A run's action is the owner's saved one, read here like the rules: a request names it and can't describe it
  const scope = r.action && scopeOf(r.action, noteActions);
  if (r.action && !scope) return { error: `No note action ${r.action.id}: it was deleted.` };
  let agent: ToolLoopAgent<never, Tools>;
  try {
    agent = await build({ notes, todo, r, rules, webGuard, foreign: ctx.foreign || historical || hasAttachment(r.history), files, scope });
  } catch (e) {
    if (e instanceof Unavailable) return { error: e.message };
    throw e;
  }
  let messages: AgentMessage[];
  try {
    // repair: chats saved before a tool's schema changed
    messages = await repair(r.history, agent.tools);
    if (!sees(r.model)) messages = withoutPictures(messages);
  } catch (e) {
    return { error: `Bad messages: ${(e as Error).message}` };
  }
  try {
    return {
      stream: await createAgentUIStream({
        agent,
        uiMessages: withContext(await inlinePdfs(messages), ctx.text),
        originalMessages: r.history,
        generateMessageId: generateId,
        abortSignal: r.abortSignal,
        timeout: MODEL_TIMEOUT,
        experimental_steering: r.steering,
        // Providers send text in bursts; re-chunk it word by word so the answer arrives at an even pace (~50 words/s)
        experimental_transform: r.smooth ? smoothStream({ delayInMs: 20 }) : undefined,
        onEnd: ({ messages: all }) => r.onEnd?.(all),
        onError: (e) => (e instanceof Error ? e.message : String(e)),
      }),
    };
  } catch (e) {
    return { error: `Bad messages: ${(e as Error).message}` };
  }
}

type Build = {
  notes: NoteService; todo: TaskService; r: TurnRequest; rules: Actions; webGuard: boolean;
  /** Someone else's text is in this turn's context (`context`), in the history, or the owner attached a file to the chat:
   *  its writes are tainted and ask, like after reading the web. */
  foreign: boolean;
  files: readonly Attached[];
  scope?: Scope;
};

async function build({ notes, todo, r, rules, webGuard, foreign, files, scope }: Build) {
  const { model: m, providerOptions } = await (r.pick ?? pickModel)(r.model);
  const { steps, reasoning } = EFFORT[r.effort];
  const read = readWeb(notes, todo), untrusted = foreign ? async () => true : read;
  const web = !!(await key("exa")), all = tools(notes, todo, untrusted, files);
  // Out of the prompt: the web tools without an Exa key, the tools the client does itself unless this page can do them,
  // what a spoken conversation has no screen for, the writes the owner never allows (a call made anyway is refused by
  // toolApproval), and in a note action's run all but the tools that action needs
  const ui = uiToolsFor(r.page), off = new Set<string>(UI_TOOL_NAMES.filter((n) => !ui.includes(n)));
  const base = (Object.keys(all) as (keyof Tools)[])
    .filter((n) => !off.has(n) && !(r.spoken && policyFor(n)?.unavailableInTalk) && (web || !policyFor(n)?.requiresExa) && allowed(policyFor(n), rules)
      && (!scope || offeredTo(scope, policyFor(n))));
  const gate = approvals(notes, todo, rules, guarded(webGuard, untrusted), files);
  return new ToolLoopAgent({
    model: m,
    // Talk's own rules ride after the chat's, so nothing the chat says about drawing, lists or markdown has to be unlearned
    instructions: `${SYSTEM}\n${PLACES}${web ? `\n${WEB}` : ""}${r.spoken ? `\n${TALK}` : ""}${scope ? `\n\n${runInstructions(scope)}` : ""}`,
    tools: all,
    stopWhen: isStepCount(steps),
    reasoning,
    // Per step: the first trims earlier turns' bulky results (loop.ts), every one picks its tools, and the last has to
    // answer, or a tool call there ends the turn with no reply
    prepareStep: async ({ stepNumber, messages }) => ({
      ...(stepNumber === 0 && { messages: trim(messages) }),
      ...(stepNumber < steps - 1 ? { activeTools: stepTools(base, await untrusted(messages), policyFor) } : lastStep()),
    }),
    toolApproval: scope ? scoped(gate, scope, policyFor) : gate,
    // A card's answer runs its write only if this server issued the card (approval-secret.ts)
    experimental_toolApprovalSecret: await approvalSecret(),
    providerOptions,
  });
}
