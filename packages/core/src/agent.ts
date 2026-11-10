// The agent's words and choices both clients share (the phone's Ask tab, the web's Ask view) and the server agent
// (server/agent) holds to: the models on offer and which one a message goes to, how a tool and a run of steps are said,
// a write's flags and line diff, the reason an unanswered confirm card is settled with. Pure: no "ai" or DOM import,
// since the sidecar loads this file outside the clients' node_modules.
import type { UiToolName } from "./assistant";
import { dropTitle, isNotePath, parseNote, picturesOf } from "./notes";
import { progress } from "./things";
import type { Task } from "./todo";

/** GET /agent/models: the models of the server's one provider (`provider`: its name, e.g. "DeepSeek"). `available`: the
 *  server holds its key. `default`: the model used when none is picked. `web`: the agent can search the web and read pages. */
export type AgentModels = { provider: string; available: boolean; default: string; models: string[]; web: boolean };

/** The model id a message goes to: the chosen one while the server still offers it (a provider change leaves an old
 *  pick behind), else the server's default. undefined: the server has no key, or hasn't said yet. */
export function pickModel(models: AgentModels | undefined, chosen: string | null | undefined): string | undefined {
  if (!models?.available) return undefined;
  return chosen && models.models.includes(chosen) ? chosen : models.default;
}

/** How hard the agent works on a message, each client's own pick sent with every request: how many model calls a turn
 *  may take, and the reasoning asked of the model (the AI SDK's portable `reasoning`; a model without it ignores it,
 *  the step limit still holds). */
export const EFFORTS = ["quick", "normal", "deep"] as const;
export type Effort = (typeof EFFORTS)[number];
export const DEFAULT_EFFORT: Effort = "normal";

export const EFFORT: Record<Effort, { steps: number; reasoning: "minimal" | "low" | "high"; about: string }> = {
  quick: { steps: 6, reasoning: "minimal", about: "Short answers, a few lookups" },
  normal: { steps: 12, reasoning: "low", about: "Most questions and edits" },
  deep: { steps: 30, reasoning: "high", about: "Long tasks across many notes; slower, costs more" },
};

/** A stored pick read defensively: anything else is the default. */
export const effortOf = (v: unknown): Effort => (EFFORTS as readonly unknown[]).includes(v) ? v as Effort : DEFAULT_EFFORT;

/** What a confirm card left unanswered (the user typed on instead) says, to the model and on the folded card. */
export const UNCONFIRMED = "Not confirmed.";

/** The reason a confirm card's "Not now" sends. */
export const DECLINED = "User declined";

/** Ends in "?": sent as is. Else a start the owner finishes in the field. */
export const SUGGEST = ["What did I note about…", "Note this: ", "What's pinned?"];

/** Sentence case for labels written lower-case in the code. */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The server agent's tools (server/agent/src/tools.ts is the authority; the UI tools the client does itself are assistant.ts's;
 *  `show_*` hand back a widget to draw, widgets.ts); a name not here shows as it is. */
export type ToolName = "show_items" | "search_notes" | "list_notes" | "list_tags" | "create_tag" | "update_tag" | "read_note" | "create_note" | "append_to_note" | "rewrite_note"
  | "summarise_links" | "set_note_flags" | "delete_note" | "update_memory" | "web_search" | "read_url" | "list_tasks" | "list_tagged" | "add_task" | "add_tasks" | "update_task" | "complete_task" | "delete_task"
  | "create_lens" | "find_place" | "set_place" | "show_day" | "show_week" | "show_review" | "show_quote" | "show_link" | "show_lens" | "show_tasks" | "show_notes" | "find_free_slots"
  | "read_drawing" | "show_drawing" | "attach_file" | UiToolName;

/** Tool names as the owner would say them. */
const LABEL: Record<ToolName, string> = {
  create_tag: "Creating a tag", create_lens: "Creating a lens", update_tag: "Changing a tag",
  show_items: "Showing what it found",
  show_day: "Showing a day", show_week: "Showing a week", show_review: "Reviewing your week", show_quote: "Quoting a note", show_link: "Showing a link",
  show_lens: "Previewing a lens", show_tasks: "Laying out tasks", show_notes: "Gathering notes", show_drawing: "Showing a drawing", read_drawing: "Looking at a drawing", find_free_slots: "Finding free time",
  search_notes: "Searching your notes", list_notes: "Listing your notes", list_tags: "Reading your tags", read_note: "Reading a note",
  create_note: "New note", append_to_note: "Adding to a note", rewrite_note: "Rewriting a note", summarise_links: "Summarising links", set_note_flags: "Changing a note's flags", delete_note: "Deleting a note",
  attach_file: "Filing an attachment", update_memory: "Memory", web_search: "Searching the web", read_url: "Reading a page",
  list_tasks: "Reading your tasks", list_tagged: "Gathering by tag", add_task: "Adding a task", add_tasks: "Adding tasks", update_task: "Changing a task", complete_task: "Completing a task",
  delete_task: "Deleting a task", find_place: "Searching the map", set_place: "Setting a place",
  open_note: "Opening a note", open_task: "Opening a task", go_view: "Going to a view", ask_choice: "Asking you to choose",
  replace_selection: "Changing the selected text", insert_after_selection: "Adding under the selected text", draw: "Drawing", save_drawing: "Saving the drawing",
};
export const label = (name: string) => LABEL[name as ToolName] ?? name;

/** What a settled step amounts to, for the summary line. A tool not in KIND is never folded away. */
export type Kind = "think" | "search" | "list" | "read" | "web" | "page" | "write" | "memory" | "tasks" | "todo" | "maps" | "place";
const KIND: Partial<Record<ToolName, Kind>> = {
  search_notes: "search", list_notes: "list", list_tags: "list", read_note: "read", web_search: "web", read_url: "page",
  create_note: "write", append_to_note: "write", rewrite_note: "write", summarise_links: "write", set_note_flags: "write", delete_note: "write", attach_file: "write", update_memory: "memory",
  find_place: "maps", set_place: "place",
  list_tasks: "tasks", list_tagged: "list", find_free_slots: "tasks", add_task: "todo", add_tasks: "todo", update_task: "todo", complete_task: "todo", delete_task: "todo",
};
export const kindOf = (name: string): Kind | undefined => KIND[name as ToolName];

const times = (what: string, n: number) => (n > 1 ? `${what} ${n}×` : what);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const SAID: Record<Kind, (n: number) => string> = {
  think: () => "thought", search: (n) => times("searched", n), list: (n) => times("listed notes", n), read: (n) => `read ${plural(n, "note")}`,
  web: (n) => times("searched the web", n), page: (n) => `read ${plural(n, "page")}`, write: (n) => `changed ${plural(n, "note")}`,
  memory: () => "updated memory", tasks: (n) => times("read tasks", n), todo: (n) => `changed ${plural(n, "task")}`,
  maps: (n) => times("searched Maps", n), place: (n) => (n > 1 ? `set ${n} places` : "set a place"),
};

/** "Thought · searched 2× · read 1 note": each kind once, in the order it first happened. */
export function gist(kinds: Kind[]) {
  const n = new Map<Kind, number>();
  for (const k of kinds) n.set(k, (n.get(k) ?? 0) + 1);
  return cap([...n].map(([k, c]) => SAID[k](c)).join(" · "));
}

// ---- cards: what the chat draws for a note or task

/** A note as a card: its place, title, tags, the opening of its body as markdown (`preview`, a few lines) and its first
 *  photo (`image`: the name in the note's attachments folder). Only what is set. */
export type NoteCard = { kind: "note"; path: string; title: string; preview: string; tags?: string[]; image?: string };

/** A task as a card: the fields a row shows, only what is set. `checklist`: boxes ticked out of all. */
export type TaskCard = {
  kind: "task"; id: string; title: string; done?: string; when?: string; evening?: true; due?: string; every?: string;
  remind?: string; checklist?: [number, number]; tags?: string[]; where?: string;
};

export type Card = NoteCard | TaskCard;

const PREVIEW_LINES = 8, PREVIEW_CHARS = 480;

/** The opening of a body as markdown: its own title line dropped and the lines that are only a picture (a card shows the
 *  first photo itself), then whole lines up to a few lines or characters; a fenced block the cut falls in is closed
 *  again. "" for an empty body. */
export function previewOf(body: string, title: string): string {
  const lines = dropTitle(body, title).trim().split("\n").filter((l) => !/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(l));
  const out: string[] = [];
  let len = 0, fence = false;
  for (const l of lines) {
    if (out.length >= PREVIEW_LINES || (out.length && len + l.length > PREVIEW_CHARS)) break;
    out.push(l.length > PREVIEW_CHARS ? `${l.slice(0, PREVIEW_CHARS)}…` : l);
    len += l.length + 1;
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
  }
  if (fence) out.push("```");
  return out.join("\n").trim();
}

/** The card of a note from its file text. */
export function noteCardOf(path: string, text: string): NoteCard {
  const n = parseNote(path, text), p = picturesOf(n.id, n.body), image = p && "pictures" in p ? p.pictures.find((x) => "image" in x) : undefined;   // a photo, or a drawing's picture
  return { kind: "note", path, title: n.title, preview: previewOf(n.body, n.title), ...(n.tags.length ? { tags: n.tags } : {}),
    ...(image && "image" in image ? { image: image.image } : {}) };
}

/** The card of a task. */
export function taskCardOf(t: Task): TaskCard {
  const count = progress(t);
  return { kind: "task", id: t.id, title: t.title, ...(t.done ? { done: t.done } : {}), ...(t.when ? { when: t.when } : {}),
    ...(t.evening ? { evening: true as const } : {}), ...(t.due ? { due: t.due } : {}),
    ...(t.every ? { every: t.every } : {}), ...(t.remind ? { remind: t.remind } : {}),
    ...(count ? { checklist: count } : {}), ...(t.tags.length ? { tags: t.tags } : {}), ...(t.where ? { where: t.where.name } : {}) };
}

const isCard = (c: unknown): c is Card => {
  const x = c as Partial<Record<string, unknown>> | null;
  return !!x && typeof x === "object" && typeof x.title === "string"
    && (x.kind === "note" ? typeof x.path === "string" && isNotePath(x.path) : x.kind === "task" && typeof x.id === "string");
};

/** The cards a finished tool call carries: a write's `card` (the record it left), or show_items' `cards`. Anything that
 *  isn't a card is left out, so a chat saved by another version still draws. */
export function cardsOf(output: unknown): Card[] {
  if (!output || typeof output !== "object") return [];
  const { card, cards } = output as { card?: unknown; cards?: unknown };
  return (Array.isArray(cards) ? cards : card ? [card] : []).filter(isCard);
}

/** The cards each part of a message shows, by part index: those of its finished tool calls. A record two parts both
 *  carry is drawn once, under the last. */
export function cardsByPart(parts: readonly object[]): Map<number, Card[]> {
  const out = new Map<number, Card[]>(), seen = new Set<string>();
  for (let i = parts.length - 1; i >= 0; i--) {
    const { state, output } = parts[i] as { state?: string; output?: unknown };      // a part that isn't a tool call has neither
    if (state !== "output-available") continue;
    const fresh: Card[] = [];
    for (const c of cardsOf(output).reverse()) if (!seen.has(cardKey(c))) { seen.add(cardKey(c)); fresh.unshift(c); }
    if (fresh.length) out.set(i, fresh);
  }
  return out;
}

/** A card's own key: what two cards of the same record share. */
export const cardKey = (c: Card) => (c.kind === "note" ? c.path : `${c.kind}:${c.id}`);

/** What the agent sends for a write: every tool's fields, all optional, as the part's input may be partial. */
export type WriteInput = {
  name?: string; description?: string;
  /** create_lens': the tags it hides and its colour (`tags`: those it shows). */
  exclude?: string[]; accent?: string;
  path?: string; title?: string; body?: string; text?: string; why?: string; section?: string;
  /** attach_file's: the attached file's name. */
  file?: string;
  pinned?: boolean; archived?: boolean; color?: string | null; tags?: string[];
  /** The task tools': the record's id, its title as the agent read it (`about`: what a card names it by), its dates
   *  (`null` clears one), `done` false to reopen; the notes it is linked to (`link`, and update_task's `unlink`: paths),
   *  its checklist (a list of texts when added, ops by item id when changed). */
  id?: string; about?: string; done?: boolean; notes?: string;
  /** set_place's: the task (its id), and the place: its OpenStreetMap id, a name alone, or `clear`. */
  task?: string; place_id?: string; clear?: boolean;
  /** update_task's text added after its notes. */
  addNotes?: string;
  when?: string | null; evening?: boolean; due?: string | null; every?: string | null; remind?: string | null;
  link?: string[]; unlink?: string[];
  /** update_task's tags to put on and take off (add_task and add_tasks set `tags`, as a note's create does). */
  addTags?: string[]; removeTags?: string[];
  /** add_tasks': the tasks, in order. */
  tasks?: TaskInput[];
  checklist?: string[] | { add?: string[]; set?: { id: string; text?: string; done?: boolean }[]; remove?: string[] };
};

/** One task of add_tasks, as its card line says it: its title, then what it sets (dates, boxes) in brackets. */
export type TaskInput = {
  title: string; notes?: string; checklist?: string[]; tags?: string[];
  when?: string; evening?: boolean; due?: string; every?: string; remind?: string;
};

/** The dates a task tool sets, as one line: add_task's, or (`change`) update_task's, where null clears. */
function taskLine(i: WriteInput, change = false) {
  const parts = [
    i.when ? (i.evening ? `${i.when}, this evening` : i.when) : change && i.when === null && "no day",
    i.due ? `due ${i.due}` : change && i.due === null && "no deadline",
    i.every ? `every ${i.every}` : change && i.every === null && "doesn't repeat",
    i.remind ? `remind ${i.remind}` : change && i.remind === null && "no reminder",
  ].filter((x): x is string => !!x);
  return cap(parts.join(" · "));
}

const quoted = (s: string | undefined, or: string) => (s?.trim() ? `“${s.trim()}”` : or);

/** A confirm card's words for a task tool: its question, the button, what the answered line says was done or
 *  left undone and of what. null for any other write. */
export function todoWords(name: string, i: WriteInput): { head: string; yes: string; done: string; skipped: string; subject: string } | null {
  const task = quoted(i.about, "a task"), reopen = i.done === false;
  switch (name) {
    case "add_task": return { head: `Add task ${quoted(i.title, "")}?`, yes: "Add it", done: "Added task", skipped: "add task", subject: quoted(i.title, "a task") };
    case "add_tasks": {
      const n = i.tasks?.length ?? 0;
      return { head: `Add ${n} task${n === 1 ? "" : "s"}?`, yes: n === 1 ? "Add it" : "Add them", done: `Added ${n} task${n === 1 ? "" : "s"}`,
        skipped: "add the tasks", subject: "the tasks" };
    }
    case "update_task": return { head: `Change ${task}?`, yes: "Save it", done: "Changed", skipped: "change", subject: task };
    case "complete_task": return reopen ? { head: `Reopen ${task}?`, yes: "Reopen it", done: "Reopened", skipped: "reopen", subject: task }
      : { head: `Complete ${task}?`, yes: "Complete it", done: "Completed", skipped: "complete", subject: task };
    case "delete_task": return { head: `Delete ${task}?`, yes: "Delete it", done: "Deleted", skipped: "delete", subject: task };
    default: return null;
  }
}

/** The lines of a task card's body: what the write does. */
export function todoLines(name: string, i: WriteInput): string[] {
  const items = i.checklist && !Array.isArray(i.checklist) ? i.checklist : undefined, texts = Array.isArray(i.checklist) ? i.checklist : items?.add;
  const list = (xs: string[] | undefined) => (xs?.length ? xs.join(", ") : "");
  const lines: (string | false | 0 | null | undefined)[] = [];
  switch (name) {
    case "add_task":
      lines.push(taskLine(i) || "No day", "In the Inbox",
        i.link?.length && `About ${list(i.link)}`, i.tags?.length && `Tags: ${list(i.tags)}`, texts?.length && `Checklist: ${list(texts)}`, i.notes);
      break;
    case "add_tasks":
      lines.push(...(i.tasks ?? []).map((t, n) => {
        const own = [taskLine(t).toLowerCase(), t.checklist?.length ? `checklist: ${list(t.checklist)}` : "", t.tags?.length ? `tags: ${list(t.tags)}` : ""].filter(Boolean);
        return `${n + 1}. ${t.title}${own.length ? ` (${own.join("; ")})` : ""}`;
      }));
      break;
    case "update_task":
      lines.push(taskLine(i, true), i.title && `Retitle to “${i.title}”`, i.notes != null && (i.notes ? `Notes: ${i.notes}` : "Clear the notes"), i.addNotes && `Add to the notes: ${i.addNotes}`,
        i.link?.length && `Link ${list(i.link)}`, i.unlink?.length && `Unlink ${list(i.unlink)}`,
        i.addTags?.length && `Add tags: ${list(i.addTags)}`, i.removeTags?.length && `Remove tags: ${list(i.removeTags)}`,
        items?.add?.length && `Add to the checklist: ${list(items.add)}`,
        items?.set?.length && `Change ${items.set.length} checklist item${items.set.length === 1 ? "" : "s"}`,
        items?.remove?.length && `Remove ${items.remove.length} checklist item${items.remove.length === 1 ? "" : "s"}`);
      break;
    case "complete_task": lines.push(i.done === false ? "Open it again" : "Mark it done"); break;
    case "delete_task": lines.push("Delete it for good"); break;
  }
  return lines.filter((x): x is string => !!x);
}

/** The flags a create sets, or the change a set_note_flags makes, as one line. */
export function flagLine(i: WriteInput, change = false) {
  const parts = [
    i.archived != null && change && (i.archived ? "archive it" : "take it out of the archive"),
    i.pinned != null && !(change && i.archived) && (change ? (i.pinned ? "pin it" : "unpin it") : i.pinned && "pinned"),
    i.color ? `${change ? "colour " : ""}${i.color}` : change && i.color === null && "no colour",
    i.tags && (i.tags.length ? `tags: ${i.tags.join(", ")}` : change && "no tags"),
  ].filter((x): x is string => !!x);
  return cap(parts.join(change ? ", " : " · "));
}

export type Line = { op: "=" | "+" | "-"; text: string };

/** Line diff by longest common subsequence, the same head and tail trimmed first so a long note with one edit is a tiny table. */
export function diffLines(a: string[], b: string[]): Line[] {
  let p = 0, q = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  const A = a.slice(p, a.length - q), B = b.slice(p, b.length - q);
  const L = Array.from({ length: A.length + 1 }, () => new Array<number>(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const mid: Line[] = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { mid.push({ op: "=", text: A[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) mid.push({ op: "-", text: A[i++] });
    else mid.push({ op: "+", text: B[j++] });
  }
  const same = (xs: string[]) => xs.map((text) => ({ op: "=" as const, text }));
  return [...same(a.slice(0, p)), ...mid, ...A.slice(i).map((text) => ({ op: "-" as const, text })),
    ...B.slice(j).map((text) => ({ op: "+" as const, text })), ...same(a.slice(a.length - q))];
}

export type Row = { l: Line } | { fold: number };

/** The lines as rows: the changes with `context` unchanged lines around each, every longer unchanged run folded to a count. */
export function rowsOf(lines: Line[], context: number, all: boolean): Row[] {
  const near = lines.map((_, i) => all || lines.slice(Math.max(0, i - context), i + context + 1).some((l) => l.op !== "="));
  const rows: Row[] = [];
  lines.forEach((l, i) => {
    if (near[i]) rows.push({ l });
    else if (near[i - 1] !== false) rows.push({ fold: 1 });
    else (rows[rows.length - 1] as { fold: number }).fold++;
  });
  return rows;
}


/** A lens create_lens proposes, for both clients' approval previews. */
export function lensLine(input: WriteInput): string {
  return [
    input.tags?.length && `Shows: ${input.tags.join(", ")}`,
    input.exclude?.length && `Hides: ${input.exclude.join(", ")}`,
    input.accent && `Colour: ${input.accent}`,
  ].filter(Boolean).join("\n");
}

/** The definition fields proposed by a tag tool, for both clients' approval previews. */
export function tagLine(name: string, input: WriteInput): string {
  return [
    input.name && `Name: ${input.name}`,
    input.color !== undefined && `Colour: ${input.color ?? "none"}`,
    input.description !== undefined && `Description: ${input.description || "(empty)"}`,
    name === "update_tag" && "Existing notes and tasks keep their tag names.",
  ].filter(Boolean).join("\n");
}
