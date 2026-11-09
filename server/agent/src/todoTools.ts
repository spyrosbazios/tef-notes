// The agent's tools for tasks, records of their own (todo.ts). A plan* turns a tool's input into the write it means, or
// the reason it can't be: tool and check share it, so the check before a confirm card (agent.ts approvals) tries exactly
// what the write would do, on the records as they are now, and a bad date, note or id goes straight back to the agent
// instead of through a card.
import { tool, type ModelMessage } from "ai";
import { z } from "zod";
import { views, newTask, type Task, type TaskPatch } from "@/core/todo";
import { fold, NOTES as NOTE_DIR, parseNote, snippetOf } from "@/core/notes";
import { localDay } from "@/core/time";
import { capList, clip } from "./guard";
import { definedTags, TAGS, type Notes } from "./notes";
import { slotOf, type Slot } from "./plan";
import { checklistEdit, taskEdit, type Edit, type TagOps, type Todo } from "./todo";

const TASKS = 100, NOTES_SNIPPET = 300;

export const DAY_RE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const WHEN = DAY_RE.describe("The day to do it (the Things 'when'), YYYY-MM-DD, worked out from today's date in <context>");
const DUE = DAY_RE.describe("The deadline, YYYY-MM-DD");
const EVERY = z.string().describe("Repeat: 1d, 2w, 1m, 1y (from its day), +3d (from the day it's done), or weekdays mon,thu");
const REMIND = z.string().describe("HH:MM on its day (needs when)");
const EVENING = z.boolean().describe("This Evening: only with when");
const NOTES = z.string().describe("Markdown notes on the task, in the user's words");
const ABOUT = z.string().max(200).describe("The task's title as list_tasks gave it: the confirm card names it by this");
const NOTE = z.string().describe("notes/<file>.md, from the index or search_notes");
const LINK = z.array(NOTE).max(20).describe("Notes this task is about, linked to it (a link, not a copy): their paths");

const OVERLAP = z.boolean().describe("Set only after the user, told of the clash this tool reported, said to book it anyway");

const TASK_TAGS = TAGS.describe("Tags for the task, only those list_tags returns; the server's auto-tagger adds others by itself. Leave it out when none clearly fits");

const ADD = z.object({
  title: z.string().min(1).max(200).describe("What to do, one line, in the user's words and language; dates are fields, never part of the title"),
  notes: NOTES.optional(),
  checklist: z.array(z.string().min(1).max(200)).max(100).optional().describe("Steps or items, one box each, in order: a shopping list is one task with these"),
  when: WHEN.optional(), evening: EVENING.optional(), due: DUE.optional(), every: EVERY.optional(), remind: REMIND.optional(),
  link: LINK.optional(), tags: TASK_TAGS.optional(), overlap: OVERLAP.optional(),
});
export type AddInput = z.infer<typeof ADD>;

const MANY = 30;
const ADD_MANY = z.object({
  tasks: z.array(ADD.omit({ link: true })).min(1).max(MANY).describe("The tasks, in order. Steps of one thing are not tasks: that is one task's checklist"),
});
export type AddManyInput = z.infer<typeof ADD_MANY>;

const UPDATE = z.object({
  id: z.string().describe("The task's id from list_tasks"), about: ABOUT,
  title: z.string().min(1).max(200).optional().describe("A new title"),
  notes: NOTES.optional().describe("Replaces all its notes: only after reading them whole; list_tasks shows a cut. To add, addNotes"),
  addNotes: z.string().min(1).optional().describe("Text added after its notes, on a new paragraph, the rest kept"),
  when: WHEN.nullable().optional(), evening: EVENING.optional(), due: DUE.nullable().optional(),
  every: EVERY.nullable().optional(), remind: REMIND.nullable().optional(), overlap: OVERLAP.optional(),
  link: LINK.optional().describe("Notes to link it to, their paths; one already linked stays"),
  unlink: z.array(NOTE).max(20).optional().describe("Linked notes to unlink, their paths (list_tasks' `linked`)"),
  addTags: TAGS.optional().describe("Tags to put on it, only those list_tags returns; one it has stays"),
  removeTags: z.array(z.string().min(1).max(40)).max(10).optional().describe("Tags to take off it, by name as list_tasks gave them"),
  checklist: z.object({
    add: z.array(z.string().min(1).max(200)).optional().describe("New boxes at the end"),
    set: z.array(z.object({ id: z.string(), text: z.string().optional(), done: z.boolean().optional() })).optional().describe("Reword or tick boxes, by item id"),
    remove: z.array(z.string()).optional().describe("Item ids to drop"),
  }).optional(),
});
/** `about` only names the task on the confirm card; the plans ignore it. */
export type UpdateInput = Omit<z.infer<typeof UPDATE>, "about"> & { about?: string };

type Plan<T> = { error: string } | T;
const bad = (p: Plan<object>) => ("error" in p ? p.error : null);

/** The notes' record ids by their paths: the ones a task is linked to. */
async function noteRecs(notes: Notes, paths: string[]): Promise<Plan<{ recs: string[] }>> {
  const recs: string[] = [];
  for (const path of paths) {
    const m = path.startsWith("notes/") ? await notes.meta(path) : undefined;
    if (!m) return { error: `No note ${path}. Take the path from the index or search_notes.` };
    if (!recs.includes(m.rec)) recs.push(m.rec);
  }
  return { recs };
}

/** The refusal of a double booking: the open tasks (and `also`, earlier ones of the same add_tasks) in `t`'s slot, other
 *  than `self`. Allowed, but only once the user knows: the agent tells them and retries with `overlap`. */
async function clash(todo: Todo, t: Slot, self = "", also: (Slot & { title: string })[] = []): Promise<string | null> {
  const slot = slotOf(t);
  if (!slot) return null;
  const open = (await todo.tasks()).filter((o) => !o.done && o.id !== self);
  const hit = [...open, ...also].filter((o) => slotOf(o) === slot);
  if (!hit.length) return null;
  const names = hit.map((o) => `“${o.title}” at ${o.remind}`).join(", ");
  return `Double booking: ${t.when} around ${t.remind} already has ${names}. Nothing was saved. Tell the user and ask: another time, or book it anyway (then call again with overlap: true).`;
}

/** A new task's plan: its fields, its checklist, and the notes it is about (record ids). */
type TaskPlan = { fields: TaskPatch & { title: string }; checklist: string[]; about: string[] };

/** add_task: the fields of the new task, its checklist and its notes; refused when a note or a value is bad. */
export async function planAdd(notes: Notes, todo: Todo, i: AddInput, earlier: TaskPlan[] = []): Promise<Plan<TaskPlan>> {
  const { checklist = [], link = [], tags, overlap, ...rest } = i;
  const fields: TaskPatch & { title: string } = { ...rest };
  const about = await noteRecs(notes, link);
  if ("error" in about) return about;
  const defined = tags && await definedTags(notes, tags);
  if (defined && "error" in defined) return defined;
  if (defined) fields.tags = defined.tags;
  if (fields.evening && !fields.when) return { error: "evening needs a when." };
  try { checklistEdit(newTask("x", fields), { add: checklist }); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  const double = !overlap && await clash(todo, newTask("x", fields), "", earlier.map((p) => newTask("x", p.fields)));
  if (double) return { error: double };
  return { fields, checklist, about: about.recs };
}

/** add_tasks: each task's fields and checklist; refused when any task's value is bad (the error names the task: nothing
 *  is written until all of them are right). */
export async function planAddMany(notes: Notes, todo: Todo, i: AddManyInput): Promise<Plan<{ items: TaskPlan[] }>> {
  const items: TaskPlan[] = [];
  for (const t of i.tasks) {
    const plan = await planAdd(notes, todo, t, items);
    if ("error" in plan) return { error: `“${t.title}”: ${plan.error}` };
    items.push(plan);
  }
  return { items };
}

/** `notes` with `more` after them, a blank line between. */
export const withNotes = (notes: string, more: string) => [notes.trimEnd(), more.trim()].filter(Boolean).join("\n\n");

/** update_task: the edit to apply to the task (its fresh copy, on a retry too) and the notes to link and unlink (record
 *  ids); refused when there is no such task, a note is none, or the edit, tried on it as it is now, is. */
export async function planUpdate(notes: Notes, todo: Todo, i: UpdateInput): Promise<Plan<{ id: string; edit: Edit<Task>; link: string[]; unlink: string[] }>> {
  const task = await todo.task(i.id);
  if (!task) return { error: `No task ${i.id}. list_tasks has the ids.` };
  const { id, about: _, checklist, link: toLink = [], unlink: toUnlink = [], addTags, removeTags, overlap, addNotes, ...rest } = i;
  if (addNotes && rest.notes !== undefined) return { error: "Pass notes (to replace them) or addNotes (to add), not both." };
  // a key left out stays; null clears (unset text is "")
  const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v === null ? "" : v])) as TaskPatch;
  const link = await noteRecs(notes, toLink), unlink = await noteRecs(notes, toUnlink);
  if ("error" in link) return link;
  if ("error" in unlink) return unlink;
  const added = addTags && await definedTags(notes, addTags);
  if (added && "error" in added) return added;
  const tags: TagOps = { add: added?.tags ?? [], remove: removeTags ?? [] };
  // links alone leave the task as it is: a link moves no rev
  const changed = Object.keys(patch).length || addNotes || checklist || tags.add.length || tags.remove.length;
  // added notes join the task's as it is when written, a retry's fresh copy too
  const edit: Edit<Task> = changed ? (t) => taskEdit(addNotes ? { ...patch, notes: withNotes(t.notes, addNotes) } : patch, checklist, tags)(t) : (t) => t;
  let after: Task;
  try { after = edit(task); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  // only a move into a slot is a booking: an edit leaving its slot as it was never refuses
  const double = !overlap && slotOf(after) !== slotOf(task) && await clash(todo, after, task.id);
  if (double) return { error: double };
  return { id, edit, link: link.recs, unlink: unlink.recs };
}

/** The checks the approvals run before a card: null when the write can go ahead. */
export const checkAdd = async (notes: Notes, todo: Todo, i: AddInput) => bad(await planAdd(notes, todo, i));
export const checkAddMany = async (notes: Notes, todo: Todo, i: AddManyInput) => bad(await planAddMany(notes, todo, i));
export const checkUpdate = async (notes: Notes, todo: Todo, i: UpdateInput) => bad(await planUpdate(notes, todo, i));
export const checkTask = async (todo: Todo, id: string) => ((await todo.task(id)) ? null : `No task ${id}. list_tasks has the ids.`);

/** A task as the model reads it: only what is set. `linked`: the paths of the notes it is about. */
function listed(t: Task, linked: string[]) {
  return {
    id: t.id, title: t.title, ...(t.notes ? { notes: clip(t.notes, NOTES_SNIPPET).text } : {}),
    ...(t.checklist.length ? { checklist: t.checklist } : {}),
    ...(t.when ? { when: t.when } : {}), ...(t.evening ? { evening: true } : {}),
    ...(t.due ? { due: t.due } : {}), ...(t.every ? { every: t.every } : {}), ...(t.remind ? { remind: t.remind } : {}),
    ...(t.done ? { done: t.done } : {}),
    ...(t.tags.length ? { tags: t.tags } : {}),
    ...(linked.length ? { linked } : {}),
  };
}

/** Whether `t` holds every word of `query` (title, notes, checklist; folded like the notes' search) and carries `tag`. */
export function matches(t: Task, query = "", tag = "") {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (tag && !t.tags.some((x) => fold(x) === fold(tag.trim()))) return false;
  if (!words.length) return true;
  const hay = fold([t.title, t.notes, ...t.checklist.map((c) => c.text)].join("\n"));
  return words.every((w) => hay.includes(w));
}

/** Whether `have` carries the tags `want` asks for (folded: case and accents ignored): every one with `all`, else any. */
export function tagged(have: string[], want: string[], all = false) {
  const h = new Set(have.map((x) => fold(x.trim())));
  const hit = (t: string) => h.has(fold(t.trim()));
  return all ? want.every(hit) : want.some(hit);
}

/** The tools over tasks for one request. `notes`: a linked note is a path here, a record id in its link.
 *  `fromPage`: whether the chat has read the web (tools.ts), so a write marks its record `tainted`. */
export function todoTools(notes: Notes, todo: Todo, fromPage: (messages: ModelMessage[]) => Promise<boolean>) {
  return {
    list_tasks: tool({
      description: "The user's tasks, as Things shows them, in a view: inbox (unscheduled), today (on or before today, or due by it; This Evening ones flagged), upcoming (a later day, soonest first), logbook (done, latest first), open (every task not done, any day), all (done ones too). `query` keeps those holding every word in the title, notes or checklist (case and accents ignored); `tag` those carrying it: to find a task, open with a query. Each with its id (update_task, complete_task and delete_task take it), checklist items with theirs, dates, `tags`, and `linked`: the notes it is about. Check before saying what's due.",
      inputSchema: z.object({
        view: z.enum(["inbox", "today", "upcoming", "logbook", "open", "all"]),
        query: z.string().max(200).optional().describe("Words a task holds, in its title, notes or checklist"),
        tag: z.string().max(40).optional().describe("Only tasks with this tag"),
        limit: z.number().int().min(1).max(TASKS).optional().describe(`Default 30, at most ${TASKS}`),
      }),
      execute: async ({ view, query, tag, limit = 30 }) => {
        const [tasks, all] = [await todo.tasks(), await notes.list()];
        const today = localDay(), v = views(tasks, today);
        const inView = view === "today" ? [...v.today, ...v.evening] : view === "upcoming" ? v.upcoming.flatMap((d) => d.tasks)
          : view === "open" ? tasks.filter((t) => !t.done) : view === "all" ? tasks : v[view];
        const list = inView.filter((t) => matches(t, query, tag));
        const { list: shown, left_out } = capList(list, limit), paths = new Map(all.map((n) => [n.rec, n.path]));
        const linked = async (t: Task) => (await todo.notesOf(t.id)).flatMap((rec) => paths.get(rec) ?? []);
        return { today, tasks: await Promise.all(shown.map(async (t) => listed(t, await linked(t)))), ...(left_out ? { left_out } : {}) };
      },
    }),

    list_tagged: tool({
      description: "Notes and tasks carrying tags, in one call: any of `tags`, or every one with `match: all` (case and accents ignored). Notes newest edit first, each with a snippet; tasks open ones only unless `done`, each as list_tasks gives it. Use it for \"everything about X\", or to see what a tag holds.",
      inputSchema: z.object({
        tags: z.array(z.string().min(1).max(40)).min(1).max(10).describe("Tag names, as list_tags gives them"),
        match: z.enum(["any", "all"]).optional().describe("any (default): an item with one of them; all: only those with every one"),
        done: z.boolean().optional().describe("Also tasks already done"),
        limit: z.number().int().min(1).max(TASKS).optional().describe(`Of each, notes and tasks; default 30, at most ${TASKS}`),
      }),
      execute: async ({ tags, match = "any", done = false, limit = 30 }) => {
        const all = match === "all", [tasks, list] = [await todo.tasks(), await notes.list()];
        const ns = list.filter((n) => n.path.startsWith(NOTE_DIR) && tagged(n.tags, tags, all)).sort((a, b) => b.updated - a.updated);
        const ts = tasks.filter((t) => (done || !t.done) && tagged(t.tags, tags, all));
        const N = capList(ns, limit), T = capList(ts, limit), paths = new Map(list.map((n) => [n.rec, n.path]));
        const linked = async (t: Task) => (await todo.notesOf(t.id)).flatMap((rec) => paths.get(rec) ?? []);
        return {
          notes: N.list.map((n) => ({ path: n.path, title: n.title, snippet: snippetOf(parseNote(n.path, n.text).body), tags: n.tags })),
          ...(N.left_out ? { notes_left_out: N.left_out } : {}),
          tasks: await Promise.all(T.list.map(async (t) => listed(t, await linked(t)))),
          ...(T.left_out ? { tasks_left_out: T.left_out } : {}),
        };
      },
    }),

    add_task: tool({
      description: "Add a task (a to-do): a record of its own, not a line in a note. The user is shown it and must confirm. Several tasks at once are add_tasks. A shopping list or steps for one thing is one task with a checklist, not a task per item. Title and notes in the user's words and language. No when or due: it stays in the Inbox. `link`: notes it is about, linked to it (paths; as many as fit). Another open task in the same hour of the same day is refused as a double booking: tell the user what it clashes with and let them pick.",
      inputSchema: ADD,
      execute: async (i, { messages }) => {
        const plan = await planAdd(notes, todo, i);
        return "error" in plan ? plan : todo.addTask(plan.fields, plan.checklist, await fromPage(messages), plan.about);
      },
    }),

    add_tasks: tool({
      description: "Add several tasks at once, in one confirm card. Use it when the user lists several separate things to do (\"add: book flights, book hotel, renew passport\"), or asks to break a goal into tasks. They go after the last task, in the order you give. Steps of ONE thing are not tasks: that is one task's checklist (add_task, or update_task on an existing one). One task alone is add_task. The user is shown them all and must confirm. Titles and notes in the user's words and language.",
      inputSchema: ADD_MANY,
      execute: async (i, { messages }) => {
        const plan = await planAddMany(notes, todo, i);
        return "error" in plan ? plan : todo.addTasks(plan.items, await fromPage(messages));
      },
    }),

    update_task: tool({
      description: "Change a task: only the fields you pass change; null clears one. Evening needs a when. `addNotes` adds to its notes (`notes` replaces them all). `checklist` adds subtasks (boxes), rewords, ticks or removes them by item id. `addTags` and `removeTags` change its tags. `link` and `unlink` add or drop notes it is about (paths). The user confirms. Ids from list_tasks. To tick the task itself use complete_task.",
      inputSchema: UPDATE,
      execute: async (i, { messages }) => {
        const plan = await planUpdate(notes, todo, i);
        return "error" in plan ? plan : todo.editTask(plan.id, plan.edit, await fromPage(messages), plan.link, plan.unlink);
      },
    }),

    complete_task: tool({
      description: "Tick a task done (or reopen it). The user confirms. A repeating task gets its next round by itself (the result's `next`). Ids from list_tasks.",
      inputSchema: z.object({ id: z.string().describe("The task's id"), about: ABOUT, done: z.boolean().optional().describe("Default true; false reopens a done task") }),
      execute: async ({ id, done = true }, { messages }) => {
        const why = await checkTask(todo, id);
        return why ? { error: why } : todo.completeTask(id, done, await fromPage(messages));
      },
    }),

    delete_task: tool({
      description: "Delete a task for good — only when the user asked to remove it (finishing one is complete_task). The user always confirms. Ids from list_tasks.",
      inputSchema: z.object({ id: z.string().describe("The task's id"), about: ABOUT }),
      execute: async ({ id }) => {
        const why = await checkTask(todo, id);
        return why ? { error: why } : todo.deleteTask(id);
      },
    }),
  };
}
