// What a chat says of each agent tool, beyond its label (agent.ts `label`): the line beside a call (`DETAIL`, every tool),
// and a write's confirm card (`CONFIRM`, every write tool: the question, the button, the answered line, what it shows). Both
// are records over the tool names, so a tool added on the server without its words here doesn't compile: the server holds
// `ToolName` to its registry, and test/tool-policy.test.ts (server/agent) its writes to `WRITE_TOOLS`. Pure and
// platform-neutral; a client draws the `Preview` kinds.
import { cap, flagLine, type ToolName, type WriteInput } from "./agent";
import { RESULT_ABOUT, RESULT_LABEL, RESULTS } from "./note-actions";

/** The tools that write, each under an owner's action (actions.ts): the ones a confirm card can be for. */
export const WRITE_TOOLS = [
  "create_tag", "create_lens", "update_tag", "create_note", "append_to_note", "rewrite_note", "summarise_links", "set_note_flags",
  "delete_note", "attach_file", "update_memory", "add_task", "add_tasks", "update_task", "complete_task", "delete_task", "set_place",
  "save_note_action",
] as const satisfies readonly ToolName[];
export type WriteTool = (typeof WRITE_TOOLS)[number];
export const isWriteTool = (name: string): name is WriteTool => (WRITE_TOOLS as readonly string[]).includes(name);

const str = (v: unknown) => (typeof v === "string" ? v : "");
type Detail = ((i: Record<string, unknown>, titleOf: (path: unknown) => string) => string) | null;
const query: Detail = (i) => str(i.query), title: Detail = (i) => str(i.title), about: Detail = (i) => str(i.about), why: Detail = (i) => str(i.why);
const note: Detail = (i, titleOf) => titleOf(i.path);

/** The line beside a tool's name in the chat: what it looked for, which note, or the agent's why. null: none. */
const DETAIL: Record<ToolName, Detail> = {
  search_notes: query, web_search: query, find_place: query,
  set_place: (i) => ["a task", i.clear ? "no place" : str(i.name) || "a place from Maps"].join(" · "),
  list_notes: (i) => str(i.filter),
  list_tagged: (i) => (Array.isArray(i.tags) ? i.tags.map(str).join(i.match === "all" ? " + " : " · ") : ""),
  read_note: note, append_to_note: note, summarise_links: note, delete_note: note, read_attachment: note, read_image: note, read_drawing: note,
  create_lens: (i) => str(i.name),
  create_tag: (i) => str(i.name) || str(i.id), update_tag: (i) => str(i.name) || str(i.id),
  create_note: title, add_task: title,
  attach_file: (i, titleOf) => [str(i.file), i.path ? titleOf(i.path) : str(i.title)].filter(Boolean).join(" · "),
  rewrite_note: (i, titleOf) => str(i.why) || titleOf(i.path),
  set_note_flags: (i, titleOf) => `${titleOf(i.path)} · ${flagLine(i as WriteInput, true)}`,
  update_task: about, complete_task: about, delete_task: about,
  list_tasks: (i) => [str(i.view), str(i.query), str(i.tag)].filter(Boolean).join(" · "),
  update_memory: why,
  read_url: (i) => (Array.isArray(i.urls) ? i.urls.join(", ") : ""), read_page: (i) => str(i.url),
  save_note_action: (i) => str(i.label),
  add_tasks: null, show_items: null, list_tags: null, list_note_actions: null, find_free_slots: null, diagram_guide: null,
  show_day: null, show_week: null, show_review: null, show_quote: null, show_link: null, show_lens: null, show_tasks: null, show_notes: null, show_drawing: null,
  open_note: null, open_task: null, go_view: null, ask_choice: null, replace_selection: null, insert_after_selection: null, draw: null, save_drawing: null,
};

/** The line beside a call to `name`, "" when it has none (or the name is no longer a tool: a saved chat's). */
export const detailOf = (name: string, i: Record<string, unknown>, titleOf: (path: unknown) => string): string =>
  DETAIL[name as ToolName]?.(i, titleOf) ?? "";

// ---- confirm cards

/** What a card's body shows: plain lines (`text`), a new note's markdown, or what the client works out against the record as
 *  it holds it now (an append's lines, a rewrite's or the memory's diff, a place's card). */
export type Preview = { kind: "text"; text: string } | { kind: "markdown"; body: string } | { kind: "append" } | { kind: "rewrite" } | { kind: "memory" } | { kind: "place" };

/** A confirm card: its question, the button, what the answered line says was done or left undone and of what, its body, and
 *  small lines above the body (`notes`) and a warning. */
type Confirmation = { head: string; yes: string; done: string; skipped: string; subject: string; preview: Preview; notes?: string[]; warning?: string };

/** The records a card names, as the client holds them: the note's title (`note`), the task set_place names (`task`). */
type Named = { note: string; task: string };

const quoted = (s: string | undefined, or: string) => (s?.trim() ? `“${s.trim()}”` : or);
const text = (t: string): Preview => ({ kind: "text", text: t });
const list = (xs: string[] | undefined) => (xs?.length ? xs.join(", ") : "");
const lines = (xs: (string | false | 0 | null | undefined)[]) => xs.filter((x): x is string => !!x).join("\n");

/** The dates a task tool sets, as one line: add_task's, or (`change`) update_task's, where null clears. */
function taskLine(i: Pick<WriteInput, "when" | "evening" | "due" | "every" | "remind">, change = false) {
  const parts = [
    i.when ? (i.evening ? `${i.when}, this evening` : i.when) : change && i.when === null && "no day",
    i.due ? `due ${i.due}` : change && i.due === null && "no deadline",
    i.every ? `every ${i.every}` : change && i.every === null && "doesn't repeat",
    i.remind ? `remind ${i.remind}` : change && i.remind === null && "no reminder",
  ].filter((x): x is string => !!x);
  return cap(parts.join(" · "));
}

/** The definition fields proposed by a tag tool. */
function tagLines(i: WriteInput, update: boolean) {
  return lines([
    i.name && `Name: ${i.name}`,
    i.color !== undefined && `Colour: ${i.color ?? "none"}`,
    i.description !== undefined && `Description: ${i.description || "(empty)"}`,
    update && "Existing notes and tasks keep their tag names.",
  ]);
}

const checklistOf = (i: WriteInput) => (i.checklist && !Array.isArray(i.checklist) ? i.checklist : undefined);
const texts = (i: WriteInput) => (Array.isArray(i.checklist) ? i.checklist : checklistOf(i)?.add);

/** Every write tool's card. */
export const CONFIRM: Record<WriteTool, (i: WriteInput, named: Named) => Confirmation> = {
  create_tag: (i) => ({ head: `Create tag “${i.name ?? ""}”?`, yes: "Save it", done: "Created", skipped: "create", subject: `tag “${i.name ?? i.id ?? ""}”`, preview: text(tagLines(i, false)) }),
  update_tag: (i) => ({ head: `Update tag “${i.name ?? i.id ?? ""}”?`, yes: "Save it", done: "Updated", skipped: "update", subject: `tag “${i.name ?? i.id ?? ""}”`, preview: text(tagLines(i, true)) }),
  create_lens: (i) => ({
    head: `Create lens “${i.name ?? ""}”?`, yes: "Save it", done: "Created", skipped: "create", subject: `lens “${i.name ?? ""}”`,
    preview: text(lines([i.tags?.length && `Shows: ${i.tags.join(", ")}`, i.exclude?.length && `Hides: ${i.exclude.join(", ")}`, i.accent && `Colour: ${i.accent}`])),
  }),
  save_note_action: (i) => {
    const does = RESULTS.find((r) => r === i.result);
    return {
      head: i.id ? `Change the note action “${i.label ?? ""}”?` : `Add the note action “${i.label ?? ""}”?`, yes: "Save it", done: "Saved", skipped: "save",
      subject: `the note action “${i.label ?? ""}”`,
      preview: text([does && `${RESULT_LABEL[does]}: ${RESULT_ABOUT[does].toLowerCase()}.`, i.prompt?.trim()].filter(Boolean).join("\n\n")),
    };
  },
  create_note: (i) => {
    const flags = flagLine(i);
    return { head: `Create note “${i.title ?? ""}”?`, yes: "Create it", done: "Created", skipped: "create", subject: `“${i.title ?? ""}”`, preview: { kind: "markdown", body: i.body ?? "" }, ...(flags ? { notes: [flags] } : {}) };
  },
  append_to_note: (i, { note }) => ({
    head: `Add to ${note}?`, yes: "Add it", done: "Added to", skipped: "add to", subject: note, preview: { kind: "append" }, ...(i.section ? { notes: [`Under “${i.section}”`] } : {}),
  }),
  rewrite_note: (_, { note }) => ({ head: `Rewrite ${note}?`, yes: "Save it", done: "Rewrote", skipped: "rewrite", subject: note, preview: { kind: "rewrite" } }),
  summarise_links: (_, { note }) => ({
    head: `Summarise the links in ${note}?`, yes: "Save it", done: "Summarised links in", skipped: "summarise links in", subject: note,
    preview: text("A summary under each link card without one, as its Summary button writes it"),
  }),
  set_note_flags: (i, { note }) => ({ head: `Change flags of ${note}?`, yes: "Save it", done: "Changed flags of", skipped: "change flags of", subject: note, preview: text(flagLine(i, true) || "No change") }),
  delete_note: (_, { note }) => ({ head: `Delete ${note}?`, yes: "Delete it", done: "Deleted", skipped: "delete", subject: note, preview: text("Delete it for good, with its photos and PDFs") }),
  attach_file: (i, { note }) => ({
    head: i.path ? `Add ${i.file ?? "the file"} to ${note}?` : `File ${i.file ?? "the file"} in a new note “${i.title ?? ""}”?`, yes: "Add it", done: "Filed", skipped: "file",
    subject: i.file ?? "the file", preview: text(lines([i.text?.trim(), `${i.file ?? "The file"}, saved to the note`, flagLine(i)])),
  }),
  update_memory: () => ({
    head: "Update the agent's memory?", yes: "Save it", done: "Updated", skipped: "update", subject: "memory", preview: { kind: "memory" },
    warning: "This chat read web pages, or a note written from them, so it asks first.",
  }),
  set_place: (i, { task }) => ({
    head: i.clear ? `Remove the place of ${task}?` : `Set the place of ${task}?`, yes: "Save it", done: "Set the place of", skipped: "set the place of", subject: task, preview: { kind: "place" },
  }),
  add_task: (i) => ({
    head: `Add task ${quoted(i.title, "")}?`, yes: "Add it", done: "Added task", skipped: "add task", subject: quoted(i.title, "a task"),
    preview: text(lines([taskLine(i) || "No day", "In the Inbox", i.link?.length && `About ${list(i.link)}`, i.tags?.length && `Tags: ${list(i.tags)}`,
      texts(i)?.length && `Checklist: ${list(texts(i))}`, i.notes])),
  }),
  add_tasks: (i) => {
    const n = i.tasks?.length ?? 0;
    return {
      head: `Add ${n} task${n === 1 ? "" : "s"}?`, yes: n === 1 ? "Add it" : "Add them", done: `Added ${n} task${n === 1 ? "" : "s"}`, skipped: "add the tasks", subject: "the tasks",
      preview: text(lines((i.tasks ?? []).map((t, k) => {
        const own = [taskLine(t).toLowerCase(), t.checklist?.length ? `checklist: ${list(t.checklist)}` : "", t.tags?.length ? `tags: ${list(t.tags)}` : ""].filter(Boolean);
        return `${k + 1}. ${t.title}${own.length ? ` (${own.join("; ")})` : ""}`;
      })) || "No change"),
    };
  },
  update_task: (i) => {
    const items = checklistOf(i);
    return {
      head: `Change ${quoted(i.about, "a task")}?`, yes: "Save it", done: "Changed", skipped: "change", subject: quoted(i.about, "a task"),
      preview: text(lines([taskLine(i, true), i.title && `Retitle to “${i.title}”`, i.notes != null && (i.notes ? `Notes: ${i.notes}` : "Clear the notes"),
        i.addNotes && `Add to the notes: ${i.addNotes}`, i.link?.length && `Link ${list(i.link)}`, i.unlink?.length && `Unlink ${list(i.unlink)}`,
        i.addTags?.length && `Add tags: ${list(i.addTags)}`, i.removeTags?.length && `Remove tags: ${list(i.removeTags)}`,
        items?.add?.length && `Add to the checklist: ${list(items.add)}`,
        items?.set?.length && `Change ${items.set.length} checklist item${items.set.length === 1 ? "" : "s"}`,
        items?.remove?.length && `Remove ${items.remove.length} checklist item${items.remove.length === 1 ? "" : "s"}`]) || "No change"),
    };
  },
  complete_task: (i) => {
    const task = quoted(i.about, "a task");
    return i.done === false
      ? { head: `Reopen ${task}?`, yes: "Reopen it", done: "Reopened", skipped: "reopen", subject: task, preview: text("Open it again") }
      : { head: `Complete ${task}?`, yes: "Complete it", done: "Completed", skipped: "complete", subject: task, preview: text("Mark it done") };
  },
  delete_task: (i) => {
    const task = quoted(i.about, "a task");
    return { head: `Delete ${task}?`, yes: "Delete it", done: "Deleted", skipped: "delete", subject: task, preview: text("Delete it for good") };
  },
};
