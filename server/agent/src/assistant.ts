// The always-on assistant on the server's side (contract: packages/core/src/assistant.ts): the page context a client sends
// with a message, rendered as the `<screen>` block at the end of the newest user message's `<context>` (agent.ts), and the UI
// tools the client does itself. Those are declared without an `execute`, so the SDK streams the call to the client and the
// turn waits for its output (`addToolOutput`); they change what the owner sees, never their data, so no confirm card.
import { tool } from "ai";
import { z } from "zod";
import { isNotePath } from "@/core/notes";
import { ASK, contextOf, GO_VIEWS, LIMITS, type AssistantContext, type AssistantView, type UiToolInput, type UiToolName } from "@/core/assistant";

/** True only when A and B are assignable both ways: a schema that drifts from the contract stops compiling. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** `body.context`: whatever the client sent, read defensively (core's `contextOf`). It never fails the request: a context
 *  that can't be read is no context, and the chat carries on as a plain one. */
export const Context = z.unknown().transform(contextOf).optional();
true satisfies Same<z.infer<typeof Context>, AssistantContext | undefined>;

const id = z.string().min(1).max(LIMITS.id);
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
};
true satisfies Same<z.infer<typeof input.open_note>, UiToolInput["open_note"]>;
true satisfies Same<z.infer<typeof input.open_task>, UiToolInput["open_task"]>;
true satisfies Same<z.infer<typeof input.go_view>, UiToolInput["go_view"]>;
true satisfies Same<z.infer<typeof input.ask_choice>, UiToolInput["ask_choice"]>;

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
} satisfies Record<UiToolName, unknown>;

// ---- the `<screen>` block

/** The owner's or the app's text as one JSON string: quoted, escaped, and no angle bracket to close a tag with. */
const q = (s: string) => JSON.stringify(s).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

const PLACE: Record<Exclude<AssistantView["kind"], "tag">, string> = {
  home: "Home", notes: "All notes", pinned: "Pinned notes", ask: "The full chat", memory: "Agent memory", settings: "Settings",
  inbox: "Inbox (task list)", today: "Today (task list)", upcoming: "Upcoming (task list)", logbook: "Logbook (task list)",
};
const place = (v: AssistantView) => (v.kind === "tag" ? `Notes tagged ${q(v.tag)}` : PLACE[v.kind]);

/** What is on screen as lines for the model, or "" for a plain chat. Last in the `<context>`: it changes with every message. */
export function screen(c: AssistantContext | undefined): string {
  if (!c) return "";
  const lines = [`Showing: ${place(c.view)}${c.client ? ` (${c.client === "web" ? "web app" : "phone app"})` : ""}`];
  if (c.note) lines.push(`Open note: ${q(c.note.path)} ${q(c.note.title)}${c.note.rev != null ? ` (rev ${c.note.rev})` : ""}`);
  if (c.task) lines.push(`Open task: ${q(c.task.id)} ${q(c.task.title)}`);
  if (c.filter) lines.push(`Filter on the list: ${q(c.filter)}`);
  if (c.selection) lines.push(`Selected text: ${q(c.selection)}`);
  return `<screen>\n${lines.join("\n")}\n</screen>`;
}
