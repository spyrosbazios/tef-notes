// The always-on assistant's contract, one home for the web app's dock and the
// server agent (server/agent/src/assistant.ts). Two halves (the widgets the server's tools hand back to draw are widgets.ts's):
//  - the page context: what a client sends with every chat request (`context` in the body), where the owner is and what is
//    open, so "this note" and "this task" mean something. The server reads it with `contextOf` (untrusted input) and renders
//    it into the newest user message's `<context>`, never into the instructions.
//  - the UI tools: tools the server declares without an `execute`, so the AI SDK streams the call to the client, which does
//    it in the app (`onToolCall`) and answers with `addToolOutput` an `UiOutput`. Most change what the owner sees, never
//    their data: no confirm card. One of them, `ask_choice`, is answered by the owner, not by the app: see "the question".
//    Two write, into the text the owner selected and asked about: see "the selection". One draws, in the web's drawing editor:
//    see "the drawing".
// Pure: no "ai" or DOM import, since the sidecar loads this file outside the clients' node_modules.

import { DRAWING_LIMITS, shapeOf, type DrawEdit, type Shape } from "./drawing";
import { isNotePath } from "./notes";
import { isDrawingName, PDF } from "./photos";

// ---- the page

/** The task lists, as the web's `/inbox` … `/logbook` and the phone's Today tab show them. */
export const TASK_LISTS = ["inbox", "today", "upcoming", "logbook"] as const;
export type TaskList = (typeof TASK_LISTS)[number];

/** The places with nothing to name: `home` (the phone's Home tab), `notes` (all notes), `pinned`, a task list, `ask` (the full chat), `talk` (the spoken one), `memory` and `settings`. Beside them a `tag`'s notes. */
export const PLAIN_VIEWS = ["home", "notes", "pinned", ...TASK_LISTS, "ask", "talk", "memory", "settings"] as const;
export type PlainView = (typeof PLAIN_VIEWS)[number];
export const VIEW_KINDS = [...PLAIN_VIEWS, "tag"] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

export type AssistantView = { kind: PlainView } | { kind: "tag"; tag: string };

/** What is on screen, sent with every message. Only what is set: a client leaves out what it doesn't have.
 *  `note`: the open note; `rev` is the one the client holds.
 *  `task`: the open task. `selection`: text the owner
 *  has selected on the page; `editable`: that text is in the open note's editor, held for the selection tools (an ask made
 *  from it, not the dock's); `filter`: the search text or filter chip applied to the list. `drawing`: the drawing open in the
 *  web's editor (see "the drawing"). */
export type AssistantContext = {
  view: AssistantView;
  note?: { path: string; title: string; rev?: number };
  task?: { id: string; title: string };
  selection?: string;
  editable?: true;
  filter?: string;
  drawing?: OpenDrawing;
};

/** How much of each piece the server keeps; a client may send less, never more. A selection asked about may be a whole
 *  section to summarise or rewrite: a client holds back an editable one longer than this rather than send it cut. */
export const LIMITS = { id: 64, tag: 60, title: 200, selection: 8000, filter: 400 } as const;

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
  const n = obj(o.note);
  if (n && typeof n.path === "string" && isNotePath(n.path)) {
    out.note = { path: n.path, title: line(n.title, LIMITS.title) };
    if (typeof n.rev === "number" && Number.isSafeInteger(n.rev) && n.rev >= 0) out.note.rev = n.rev;
  }
  const t = obj(o.task), id = t && idOf(t.id);
  if (t && id) out.task = { id, title: line(t.title, LIMITS.title) };
  const selection = typeof o.selection === "string" ? o.selection.trim().slice(0, LIMITS.selection) : "";
  if (selection) out.selection = selection;
  if (selection && out.note && o.editable === true) out.editable = true;
  const filter = line(o.filter, LIMITS.filter);
  if (filter) out.filter = filter;
  const drawing = drawingOf(o.drawing);
  if (drawing) out.drawing = drawing;
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
  replace_selection: { text: string };
  insert_after_selection: { text: string };
  draw: DrawInput;
  save_drawing: { path: string };
};
export type UiToolName = keyof UiToolInput;
/** Where `go_view` can go: any view. */
export const GO_VIEWS = VIEW_KINDS;
export type GoViewKind = ViewKind;

export const UI_TOOL_NAMES = ["open_note", "open_task", "go_view", "ask_choice", "replace_selection", "insert_after_selection", "draw", "save_drawing"] as const satisfies readonly UiToolName[];
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
 *  would hang), so none; the selection tools only when it holds an editable selection. */
export function uiToolsFor(context: AssistantContext | undefined): readonly UiToolName[] {
  if (!context) return [];
  return context.editable ? UI_TOOL_NAMES : UI_TOOL_NAMES.filter((n) => !isSelectionTool(n));
}

// ---- the selection

// An ask made from selected words in a note (the web's selection bar) carries them as an `editable` selection, and the agent
// may then change those words in place: `replace_selection` puts its markdown where they are, `insert_after_selection` adds
// its markdown under the block they end in. The client's editor does it, as the owner's own edit: saved like their typing,
// undone with Undo; refused (`{ error }`) when the words changed meanwhile or the note was closed. Every other tool stays
// on offer (a task made of the words, a note linked), with its card as ever. Withdrawn once the turn has read someone
// else's text, like memory (server/agent/src/loop.ts): a page's instructions would otherwise write with no card.

export const SELECTION_TOOL_NAMES = ["replace_selection", "insert_after_selection"] as const satisfies readonly UiToolName[];
export type SelectionToolName = (typeof SELECTION_TOOL_NAMES)[number];
export const isSelectionTool = (name: string): name is SelectionToolName => (SELECTION_TOOL_NAMES as readonly string[]).includes(name);
/** The most markdown one call may write. */
export const SELECTION_TEXT_MAX = 20_000;

// ---- the drawing

// A note's drawings are Excalidraw scenes attached to it (ARCHITECTURE.md), edited in the web's drawing editor, which opens over
// the note and leaves the assistant's dock beside it. While one is open, every request's context carries it as shapes
// (core/drawing.ts `shapesOf`): its note, its file (none while it is new and unsaved), what is on it and what the owner has
// selected. `draw` opens a drawing in that editor (one named of the note's, else the note's open one, else a new one) and makes
// an edit on it (`DrawEdit`), in sight, undoable, and unsaved: the owner keeps it with Save, as they keep their own strokes, so
// a draw never writes by itself and needs no card. `save_drawing` is that Save, pressed for the owner who asked for it:
// the open drawing over the note it names is saved as it is on screen (a new one linked into the note), as their own Save
// would. Withdrawn once the turn is tainted (server/agent/src/loop.ts), like the selection tools: then only the owner saves. Saving a new drawing links it into the note. The resumed request's context
// shows the drawing as it then is, with the ids to change it by.

/** The drawing open in the editor: `name` its file (`drawing.excalidraw`), absent while new; `shapes` at most
 *  `DRAWING_LIMITS.shown` of them, `more` how many were left out; `selected` the ids the owner has selected; `unsaved` it holds
 *  changes not saved yet. */
export type OpenDrawing = { path: string; name?: string; shapes: Shape[]; more?: number; selected?: string[]; unsaved?: true };

/** `save_drawing`'s answer: saved, with the drawing's file name (a new one's is made on its first save). */
export type SaveDrawingOutput = { ok: true; name: string } | { error: string };

/** `draw`'s input: the note (`path`), which of its drawings (`name`, else the open one, else a new one), and the edit. */
export type DrawInput = { path: string; name?: string } & DrawEdit;

/** `draw`'s answer: done, with a picture of the drawing as it then is (a data URL the client's editor exported), which the
 *  model is shown so it can see what it drew and set right what doesn't look it; or why not. The picture rides only in the
 *  live turn: the server drops it before it saves the chat (server/agent/src/drawings.ts `withoutPictures`), and before a
 *  model that takes no images. */
export type DrawOutput = { ok: true; picture?: string } | { error: string };

/** The largest picture an answer may carry, as a data URL's length. */
export const DRAW_PICTURE_MAX = 2_000_000;

/** The picture a `draw` answer carries, split for the model: its type and base64 data; null without a usable one. */
export function drawPictureOf(output: unknown): { mediaType: string; data: string } | null {
  const p = obj(output)?.picture;
  if (typeof p !== "string" || p.length > DRAW_PICTURE_MAX) return null;
  const m = /^data:(image\/(?:png|webp|jpeg));base64,([A-Za-z0-9+/]+=*)$/.exec(p);
  return m ? { mediaType: m[1], data: m[2] } : null;
}


/** The open drawing out of a context's `drawing` (untrusted), or undefined. */
function drawingOf(raw: unknown): OpenDrawing | undefined {
  const d = obj(raw);
  if (!d || typeof d.path !== "string" || !isNotePath(d.path)) return undefined;
  const all = (Array.isArray(d.shapes) ? d.shapes : []).map(shapeOf).filter((s): s is Shape => !!s);
  const shapes = all.slice(0, DRAWING_LIMITS.shown);
  const more = all.length - shapes.length + (typeof d.more === "number" && Number.isSafeInteger(d.more) && d.more > 0 ? d.more : 0);
  const ids = new Set(shapes.map((s) => s.id));
  const selected = (Array.isArray(d.selected) ? d.selected : []).filter((x): x is string => typeof x === "string" && ids.has(x));
  return {
    path: d.path, ...(isDrawingName(d.name) ? { name: d.name } : {}), shapes, ...(more > 0 ? { more } : {}),
    ...(selected.length ? { selected } : {}), ...(d.unsaved === true ? { unsaved: true } : {}),
  };
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

/** The UI tools answer with `UiOutput`, but `ask_choice` with `ChoiceOutput`, `draw` with `DrawOutput`, `save_drawing` with `SaveDrawingOutput`. */
export type UiOutputOf<N extends UiToolName> = N extends "ask_choice" ? ChoiceOutput : N extends "draw" ? DrawOutput : N extends "save_drawing" ? SaveDrawingOutput : UiOutput;

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

// ---- Attachments: photos and PDFs the owner adds to a message ----
// They ride in the user message as the AI SDK's file parts (data URLs) and are saved with the chat. A photo goes as the
// picture the model looks at (photos.ts `lookSize`, JPEG); a PDF as it is, which the server turns into its text before the
// model sees it (server/agent/src/pdfs.ts `inlinePdfs`). Either is someone else's content: a turn that carries one is
// tainted like one that read the web (its writes ask).

/** What the field's file picker takes. */
export const ATTACH_ACCEPT = "image/*,application/pdf";
/** At most this many files on one message, and a PDF no bigger than this (it is resent with every later message). */
export const ATTACH_MAX = 6, ATTACH_PDF_MAX = 8 * 1024 * 1024;

/** Whether a message history holds a file the owner attached (the server's taint check). */
export const hasAttachment = (messages: readonly { role?: unknown; parts?: readonly { type?: unknown }[] }[]) =>
  messages.some((m) => m.role === "user" && m.parts?.some((p) => p.type === "file"));

/** Steering: a message the owner sends into the turn that is running (`POST /agent/chat/:id/steer`). The model reads it
 *  at the next step boundary and it shows in the reply as a `steering-message` part; `delivered: false` when the turn
 *  ended first (finished, stopped, or waiting on a card), and the client sends it as an ordinary message instead. */
export const STEER_MAX = 4000;
export type SteerBody = { text: string };
export type SteerResult = { delivered: boolean };

/** One file the owner attached, as the agent's attach_file finds it: its name as the message gave it, its type, the data URL. */
export type Attached = { name: string; mediaType: string; url: string };

/** Every file the owner attached in the chat, oldest first, a name taken twice kept by its newest (what the owner means by it). */
export function attachedFiles(messages: readonly { role?: unknown; parts?: readonly unknown[] }[]): Attached[] {
  const out = new Map<string, Attached>();
  let n = 0;
  for (const m of messages) {
    if (m.role !== "user") continue;
    for (const p of m.parts ?? []) {
      const f = obj(p);
      if (f?.type !== "file" || typeof f.url !== "string" || typeof f.mediaType !== "string") continue;
      const name = typeof f.filename === "string" && f.filename.trim() ? f.filename.trim() : `attachment-${++n}`;
      out.delete(name);
      out.set(name, { name, mediaType: f.mediaType, url: f.url });
    }
  }
  return [...out.values()];
}

/** The context's line on them, so the agent can name one to attach_file; empty when there are none. */
export const attachedBlock = (files: readonly Attached[]) => files.length
  ? `<attached>\n${files.map((f) => `${f.name} (${f.mediaType === PDF ? "PDF" : "picture"})`).join("\n")}\n</attached>` : "";
