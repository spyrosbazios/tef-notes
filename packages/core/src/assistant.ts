// The always-on assistant's contract, one home for both clients (the web's docked panel, the phone's overlay) and the
// server agent (server/agent/src/assistant.ts). Two halves (the widgets the server's tools hand back to draw are widgets.ts's):
//  - the page context: what a client sends with every chat request (`context` in the body), where the owner is and what is
//    open, so "this note" and "this task" mean something. The server reads it with `contextOf` (untrusted input) and renders
//    it into the newest user message's `<context>`, never into the instructions.
//  - the UI tools: tools the server declares without an `execute`, so the AI SDK streams the call to the client, which does
//    it in the app (`onToolCall`) and answers with `addToolOutput` an `UiOutput`. They change what the owner sees, never
//    their data: no confirm card. One of them, `ask_choice`, is answered by the owner, not by the app: see "the question".
// Pure: no "ai", RN or DOM import, since the sidecar loads this file outside the clients' node_modules.

import { isNotePath } from "./notes";

// ---- the page

/** The task lists, as the web's `/inbox` … `/logbook` and the phone's Today tab show them. */
export const TASK_LISTS = ["inbox", "today", "upcoming", "logbook"] as const;
export type TaskList = (typeof TASK_LISTS)[number];

/** The places with nothing to name: `home` (the phone's Home tab), `notes` (all notes), `pinned`, a task list, `ask` (the full chat), `memory` and `settings`. Beside them a `tag`'s notes. */
export const PLAIN_VIEWS = ["home", "notes", "pinned", ...TASK_LISTS, "ask", "memory", "settings"] as const;
export type PlainView = (typeof PLAIN_VIEWS)[number];
export const VIEW_KINDS = [...PLAIN_VIEWS, "tag"] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

export type AssistantView = { kind: PlainView } | { kind: "tag"; tag: string };

/** What is on screen, sent with every message. Only what is set: a client leaves out what it doesn't have.
 *  `note`: the open note; `rev` is the one the client holds.
 *  `task`: the open task. `selection`: text the owner
 *  has selected on the page; `filter`: the search text or filter chip applied to the list. */
export type AssistantContext = {
  client?: "web" | "phone";
  view: AssistantView;
  note?: { path: string; title: string; rev?: number };
  task?: { id: string; title: string };
  selection?: string;
  filter?: string;
};

/** How much of each piece the server keeps; a client may send less, never more. */
export const LIMITS = { id: 64, tag: 60, title: 200, selection: 2000, filter: 400 } as const;

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
/** One line, whitespace collapsed, cut at `max`; "" for anything but a string. */
const line = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
/** A record id: short, `[A-Za-z0-9_-]` only. */
const idOf = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s.length >= 1 && s.length <= LIMITS.id && /^[\w-]+$/.test(s) ? s : ""; };

/** A view out of a kind and its argument, or null: the one place a view's shape is checked (context and `go_view`). */
export function viewFrom(kind: unknown, arg?: { tag?: unknown }): AssistantView | null {
  if (typeof kind !== "string" || !(VIEW_KINDS as readonly string[]).includes(kind)) return null;
  if (kind === "tag") { const tag = line(arg?.tag, LIMITS.tag).replace(/^#/, ""); return tag ? { kind, tag } : null; }
  return { kind } as AssistantView;
}

/** The context out of a request body's `context`: bounded, one line per field (except `selection`), and a piece that doesn't
 *  fit dropped, not guessed at. undefined without a readable view: there is no context then. */
export function contextOf(raw: unknown): AssistantContext | undefined {
  const o = obj(raw);
  const view = o && obj(o.view) && viewFrom(obj(o.view)!.kind, obj(o.view)!);
  if (!o || !view) return undefined;
  const out: AssistantContext = { view };
  if (o.client === "web" || o.client === "phone") out.client = o.client;
  const n = obj(o.note);
  if (n && typeof n.path === "string" && isNotePath(n.path)) {
    out.note = { path: n.path, title: line(n.title, LIMITS.title) };
    if (typeof n.rev === "number" && Number.isSafeInteger(n.rev) && n.rev >= 0) out.note.rev = n.rev;
  }
  const t = obj(o.task), id = t && idOf(t.id);
  if (t && id) out.task = { id, title: line(t.title, LIMITS.title) };
  const selection = typeof o.selection === "string" ? o.selection.trim().slice(0, LIMITS.selection) : "";
  if (selection) out.selection = selection;
  const filter = line(o.filter, LIMITS.filter);
  if (filter) out.filter = filter;
  return out;
}

// ---- the UI tools

/** What the client does for each: open a note, open a task beside its
 *  list, go to a view, put a question to the owner. `path`, `id` and `tag` are as the other tools and the context name them. */
export type UiToolInput = {
  open_note: { path: string };
  open_task: { id: string };
  go_view: { view: GoViewKind; tag?: string };
  ask_choice: { question: string; options: ChoiceOption[]; multi?: boolean };
};
export type UiToolName = keyof UiToolInput;
/** Where `go_view` can go: any view. */
export const GO_VIEWS = VIEW_KINDS;
export type GoViewKind = ViewKind;

export const UI_TOOL_NAMES = ["open_note", "open_task", "go_view", "ask_choice"] as const satisfies readonly UiToolName[];
export const isUiTool = (name: string): name is UiToolName => (UI_TOOL_NAMES as readonly string[]).includes(name);

/** What a client answers a UI tool with (`addToolOutput({ tool, toolCallId, output })`): `{ ok: true }` once the app shows it,
 *  `{ error }` when it can't (no such note, nothing to open): the model reads it and says so. Always answer: a call left
 *  without an output is closed as an error on the next send. `ask_choice` is answered with a `ChoiceOutput` instead. */
export type UiOutput = { ok: true } | { error: string };
export const UI_OK: UiOutput = { ok: true };
export const uiError = (error: string): UiOutput => ({ error });

/** The view a `go_view` call asks for; null when its tag is missing (the client answers `uiError`). */
export const goView = (i: UiToolInput["go_view"]): AssistantView | null => viewFrom(i.view, i);

/** The UI tools a request may use: those the client can do. Without a context there is no assistant to do them (the call
 *  would hang), so none; a page that can't do one narrows the list here. */
export function uiToolsFor(context: AssistantContext | undefined): readonly UiToolName[] {
  return context ? UI_TOOL_NAMES : [];
}

// ---- the question

// `ask_choice`: the model puts a question with a few buttons in the chat and goes on with the one the owner taps. Unlike the
// other UI tools the app does not answer it by itself: a client's `onToolCall` leaves it alone (`isAskTool`), draws the
// buttons from the call's input (`choiceFrom`) and answers with `addToolOutput({ tool: "ask_choice", toolCallId, output })`
// when the owner taps (`choiceOutput`), which resumes the turn like any UI tool's answer. The choice never writes: what
// follows it is the model's own tool calls, a write among them with its confirm card as ever.

/** One button: `id` is what comes back, `label` what it says, `hint` a quieter line under it. */
export type ChoiceOption = { id: string; label: string; hint?: string };

/** What the question allows: 2 to 6 options, and how long each piece may be (the server's schema holds to these). */
export const ASK = { min: 2, max: 6, id: 40, question: 300, label: 60, hint: 120 } as const;

/** The owner's answer: the ids they chose (one unless the question was `multi`; none is not an answer: a client lets the owner
 *  send only with something chosen), or `{ error }` when the question can't be shown or they dismissed it. */
export type ChoiceOutput = { chosen: string[] } | { error: string };

/** The UI tools answer with `UiOutput`, but `ask_choice` with `ChoiceOutput`. */
export type UiOutputOf<N extends UiToolName> = N extends "ask_choice" ? ChoiceOutput : UiOutput;

/** The tool the owner answers, not the app: its call waits in the chat, drawn as buttons, until they tap. */
export const isAskTool = (name: string): name is "ask_choice" => name === "ask_choice";

export const choiceOutput = (chosen: readonly string[]): ChoiceOutput => ({ chosen: [...chosen] });

/** The question to draw out of a call's input (untrusted, and partial while it streams): null until it holds a question and 2 or
 *  more usable options. A repeated id is dropped; more than `ASK.max` options are cut. */
export function choiceFrom(input: unknown): UiToolInput["ask_choice"] | null {
  const o = obj(input);
  const question = line(o?.question, ASK.question);
  const options: ChoiceOption[] = [];
  for (const raw of Array.isArray(o?.options) ? o.options : []) {
    const x = obj(raw), id = typeof x?.id === "string" ? x.id.trim().slice(0, ASK.id) : "", label = line(x?.label, ASK.label), hint = line(x?.hint, ASK.hint);
    if (id && label && !options.some((p) => p.id === id)) options.push({ id, label, ...(hint ? { hint } : {}) });
  }
  if (!question || options.length < ASK.min) return null;
  return { question, options: options.slice(0, ASK.max), ...(o?.multi === true ? { multi: true } : {}) };
}

/** The ids a finished `ask_choice` call was answered with (its `output`), for the line that says what was chosen; null for an error, or
 *  anything that isn't an answer. */
export function chosenOf(output: unknown): string[] | null {
  const c = obj(output)?.chosen;
  return Array.isArray(c) && c.every((x) => typeof x === "string") ? c : null;
}
