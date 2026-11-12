// The always-on assistant on the server's side (contract: packages/core/src/assistant.ts): the page context a client sends
// with a message, rendered as the `<screen>` block at the end of the newest user message's `<context>` (agent.ts), and the UI
// tools the client does itself. Those are declared without an `execute`, so the SDK streams the call to the client and the
// turn waits for its output (`addToolOutput`); they change what the owner sees, never their data, so no confirm card. The
// selection tools are the exception: the owner's editor writes them, in sight and undoable (core's "the selection"); so is
// `draw`, whose edit lands in the open drawing unsaved, the owner's to keep, and
// `save_drawing`, which saves it when the owner asked for that (core's "the drawing").
import { tool } from "ai";
import { z } from "zod";
import { isNotePath } from "@/core/notes";
import { isDrawingName } from "@/core/photos";
import { ASK, contextOf, drawPictureOf, GO_VIEWS, LIMITS, SELECTION_TEXT_MAX, type AssistantContext, type AssistantView, type UiToolInput, type UiToolName } from "@/core/assistant";
import { DRAW_COLOR_NAMES, DRAW_KINDS, DRAWING_LIMITS, FONT_SIZES, type DrawColor, type FontSize } from "@/core/drawing";

/** True only when A and B are assignable both ways: a schema that drifts from the contract stops compiling. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** `body.context`: whatever the client sent, read defensively (core's `contextOf`). It never fails the request: a context
 *  that can't be read is no context, and the chat carries on as a plain one. */
export const Context = z.unknown().transform(contextOf).optional();
true satisfies Same<z.infer<typeof Context>, AssistantContext | undefined>;

const id = z.string().min(1).max(LIMITS.id);
const shapeId = z.string().min(1).max(DRAWING_LIMITS.id).regex(/^[\w-]+$/, "letters, digits, - and _");
const color = z.enum(DRAW_COLOR_NAMES as [DrawColor, ...DrawColor[]]);
const size = z.enum(Object.keys(FONT_SIZES) as [FontSize, ...FontSize[]]);
const at = z.number().describe("Canvas pixels"), text = z.string().max(DRAWING_LIMITS.text);
const input = {
  open_note: z.object({ path: z.string().refine(isNotePath, "notes/<file>.md").describe("notes/<file>.md, from the index, a search or the screen") }),
  open_task: z.object({ id: id.describe("The task's id, as list_tasks or the screen gave it") }),
  go_view: z.object({
    view: z.enum(GO_VIEWS).describe("home, notes (all), pinned, a task list (inbox today upcoming logbook), ask, memory, settings, or tag"),
    tag: z.string().min(1).max(LIMITS.tag).optional().describe("With view tag: the tag"),
  }),
  ask_choice: z.object({
    question: z.string().min(1).max(ASK.question).describe("One short question, in the owner's language"),
    options: z.array(z.object({
      id: z.string().min(1).max(ASK.id).describe("What comes back if it is chosen: a time, a date, a tag, a task id, a word of your own"),
      label: z.string().min(1).max(ASK.label).describe("The button's text"),
      hint: z.string().min(1).max(ASK.hint).optional().describe("A quieter line under it"),
    })).min(ASK.min).max(ASK.max).refine((os) => new Set(os.map((o) => o.id)).size === os.length, "Each option needs an id of its own"),
    multi: z.boolean().optional().describe("The owner may choose several (tags, tasks); default one"),
  }),
  replace_selection: z.object({ text: z.string().max(SELECTION_TEXT_MAX).describe("Markdown that takes the selected text's place; empty removes it") }),
  insert_after_selection: z.object({ text: z.string().min(1).max(SELECTION_TEXT_MAX).describe("Markdown blocks to add under the block the selection ends in") }),
  draw: z.object({
    path: z.string().refine(isNotePath, "notes/<file>.md").describe("The note the drawing is in"),
    name: z.string().refine(isDrawingName, "<name>.excalidraw").optional().describe("One of its drawings, the last part of its link (sketch.excalidraw); leave out for the drawing open on screen, else a new one"),
    add: z.array(z.object({
      id: shapeId.describe("Your id for it, new in this drawing: what arrows and later changes name it by"),
      type: z.enum(DRAW_KINDS),
      x: at.optional(), y: at.optional(),
      w: z.number().optional().describe("Width; for a line or an arrow, where it ends from x (may be negative)"),
      h: z.number().optional().describe("Height; for a line or an arrow, where it ends from y (may be negative)"),
      text: text.optional().describe("A box's label (centred in it), a text's words, an arrow's label"),
      from: shapeId.optional().describe("An arrow's start: a shape's id"), to: shapeId.optional().describe("An arrow's end: a shape's id"),
      stroke: color.optional().describe("Line and text colour; default black"), fill: color.optional().describe("A light fill; default none"),
      dashed: z.boolean().optional(), size: size.optional().describe("A text's size: s m (default) l xl"),
    })).max(DRAWING_LIMITS.add).optional(),
    update: z.array(z.object({
      id: shapeId, x: at.optional(), y: at.optional(), w: z.number().optional(), h: z.number().optional(), text: text.optional(),
      stroke: color.optional(), fill: color.or(z.literal("none")).optional(), dashed: z.boolean().optional(), size: size.optional(),
    })).max(DRAWING_LIMITS.update).optional().describe("Fields to change on shapes there are, by id; moving a box takes its label and arrows along"),
    remove: z.array(shapeId).max(DRAWING_LIMITS.remove).optional().describe("Ids of shapes to delete"),
  }),
  save_drawing: z.object({ path: z.string().refine(isNotePath, "notes/<file>.md").describe("The note the open drawing is over") }),
};
true satisfies Same<z.infer<typeof input.open_note>, UiToolInput["open_note"]>;
true satisfies Same<z.infer<typeof input.open_task>, UiToolInput["open_task"]>;
true satisfies Same<z.infer<typeof input.go_view>, UiToolInput["go_view"]>;
true satisfies Same<z.infer<typeof input.ask_choice>, UiToolInput["ask_choice"]>;
true satisfies Same<z.infer<typeof input.replace_selection>, UiToolInput["replace_selection"]>;
true satisfies Same<z.infer<typeof input.insert_after_selection>, UiToolInput["insert_after_selection"]>;
true satisfies Same<z.infer<typeof input.draw>, UiToolInput["draw"]>;
true satisfies Same<z.infer<typeof input.save_drawing>, UiToolInput["save_drawing"]>;

const ANSWER = "The app does it and answers; if it can't (no such note), it says why.";
/** No `execute`: the client does these (`ask_choice` the owner does, by tapping). Only offered when the request has a context (`uiToolsFor`). */
export const uiTools = {
  open_note: tool({ description: `Open a note in the app for the owner. ${ANSWER}`, inputSchema: input.open_note }),
  open_task: tool({ description: `Open a task in the app, beside its list. ${ANSWER}`, inputSchema: input.open_task }),
  go_view: tool({ description: `Go to a place in the app: all notes, the pinned ones, a tag's notes, a task list, memory or settings. ${ANSWER}`, inputSchema: input.go_view }),
  ask_choice: tool({
    description: "Put a question with 2 to 6 buttons in the chat and wait for the owner's tap: a free slot to book, when to move a task (Today, Tomorrow, Next week), which tags, what to do with a list of overdue tasks. The answer is `{ chosen: [the ids] }` (one id unless `multi`), or `{ error }` if it can't be shown. It changes nothing by itself: make the change with the usual tool afterwards, which asks as it always does. Ask once and stop: the turn goes on with their tap.",
    inputSchema: input.ask_choice,
  }),
  replace_selection: tool({
    description: "Put new markdown where the owner's selected text is (only when the screen says it is editable): their editor makes the change, which they can undo. Answers `{ ok: true }`, or `{ error }` when the words changed meanwhile or the note was closed: then say so, don't retry.",
    inputSchema: input.replace_selection,
  }),
  insert_after_selection: tool({
    description: "Add markdown blocks under the block the owner's selected text ends in (only when the screen says it is editable), leaving the selection as it is. Answers `{ ok: true }` or `{ error }`, as replace_selection.",
    inputSchema: input.insert_after_selection,
  }),
  draw: tool({
    description: "Draw in one of a note's Excalidraw drawings, in the web app's drawing editor, which opens over the note beside the chat: sketches, diagrams, flows, wireframes. Names a drawing of the note (`name`), else the one open on screen, else starts a new one; then adds, changes and removes shapes. The owner sees it happen and keeps it with Save (a new drawing is then linked into the note), or undoes it: it is never saved by itself, so it needs no card; save_drawing saves it when they asked you to. Answers with a picture of the drawing as it then is (look at it, and fix what is off), and from then on the <screen> shows the drawing's shapes with their ids, the owner's own strokes and selection too: read it before changing anything. To look at one without opening it, read_drawing. For a diagram or a wireframe, diagram_guide first. Lay it out yourself: boxes on a grid with room between them (24 px or more), labels short enough for their box, arrows joining shapes by id. A phone screen is 390x844, a laptop's 1440x900.",
    inputSchema: input.draw,
    // The app's answer carries a picture of the drawing after the edit: shown to the model, so it sees what it drew
    toModelOutput: ({ output }) => {
      const o = output as { error?: unknown };
      if (typeof o?.error === "string") return { type: "error-text" as const, value: o.error };
      const picture = drawPictureOf(output);
      if (!picture) return { type: "json" as const, value: { ok: true } };
      return {
        type: "content" as const,
        value: [
          { type: "text" as const, text: "Done. This is the drawing now, as the owner sees it. Check it: labels inside their shapes, nothing overlapping that shouldn't, arrows joining what they should, an even layout. Fix what is off with another draw call (twice at most), then answer." },
          { type: "file" as const, mediaType: picture.mediaType, data: { type: "data" as const, data: picture.data } },
        ],
      };
    },
  }),
  save_drawing: tool({
    description: "Save the drawing open in the editor over the note, as it is on screen, as the owner's Save button would (a new drawing is then linked into the note). Only when the owner asked you to save or keep it, or to make a drawing for a note and leave it there; otherwise they keep a drawing with Save themselves. Answers `{ ok: true, name }` (its file, for read_drawing and show_drawing) or `{ error }`: then say so.",
    inputSchema: input.save_drawing,
  }),
} satisfies Record<UiToolName, unknown>;

// ---- the `<screen>` block

/** The owner's or the app's text as one JSON string: quoted, escaped, and no angle bracket to close a tag with. */
const q = (s: string) => JSON.stringify(s).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

const PLACE: Record<Exclude<AssistantView["kind"], "tag">, string> = {
  home: "Home", notes: "All notes", pinned: "Pinned notes", ask: "The full chat", talk: "Talk (the spoken chat)", memory: "Agent memory", settings: "Settings",
  inbox: "Inbox (task list)", today: "Today (task list)", upcoming: "Upcoming (task list)", logbook: "Logbook (task list)",
};
const place = (v: AssistantView) => (v.kind === "tag" ? `Notes tagged ${q(v.tag)}` : PLACE[v.kind]);

/** What is on screen as lines for the model, or "" for a plain chat. Last in the `<context>`: it changes with every message. */
export function screen(c: AssistantContext | undefined): string {
  if (!c) return "";
  const lines = [`Showing: ${place(c.view)}`];
  if (c.note) lines.push(`Open note: ${q(c.note.path)} ${q(c.note.title)}${c.note.rev != null ? ` (rev ${c.note.rev})` : ""}`);
  if (c.task) lines.push(`Open task: ${q(c.task.id)} ${q(c.task.title)}`);
  if (c.filter) lines.push(`Filter on the list: ${q(c.filter)}`);
  if (c.selection) lines.push(`Selected text${c.editable ? " (editable: in the open note, replace_selection and insert_after_selection change it)" : ""}: ${q(c.selection)}`);
  if (c.drawing) lines.push(...drawingLines(c.drawing));
  return `<screen>\n${lines.join("\n")}\n</screen>`;
}

/** The open drawing: which, and its shapes one to a line, as JSON (the owner's words in them escaped like any). */
function drawingLines(d: NonNullable<AssistantContext["drawing"]>): string[] {
  const which = d.name ? q(d.name) : "a new drawing, not saved yet";
  const state = d.name ? (d.unsaved ? ", with changes not saved yet" : ", everything on it saved") : "";
  const out = [`Open drawing (in the editor, over the note; draw changes it): ${which} in ${q(d.path)}${state}`];
  if (!d.shapes.length) out.push("It is empty.");
  else {
    out.push("Its shapes, bottom to top (x, y: top-left; w, h: size, or where a line ends):");
    for (const s of d.shapes) out.push(JSON.stringify(s).replace(/</g, "\\u003c").replace(/>/g, "\\u003e"));
  }
  if (d.more) out.push(`(${d.more} more not listed)`);
  if (d.selected?.length) out.push(`Selected by the owner: ${d.selected.map(q).join(", ")}`);
  return out;
}
