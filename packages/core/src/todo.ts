// Tasks as records of their own (server/pb_migrations/1792900000_todo.js): Things' to-dos, no longer lines in notes. What every client does with them, pure: make one,
// patch it (evening needs a when), tick it (a repeating one leaves a done copy in the
// Logbook and goes on as a new record), sort them into Things' lists, and merge two edits of one record field by field.
// Unset text is "", as PocketBase stores it. `today` is the caller's local `YYYY-MM-DD` (localDay()), never read here.

import { addDays, daysBetween, nextOccurrence, type Every } from "./dates";
import { fold } from "./notes";

const two = (n: number) => String(n).padStart(2, "0");
/** `YYYY-MM-DD`, and a day the calendar has. */
export const isDay = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}` === s;
};
/** `1d 2w 1m 1y` (fixed: from the scheduled date), `+3d` (from the day it was done), `mon,thu` (those weekdays). */
export const EVERY = /^(\+?[1-9]\d{0,2}[dwmy]|(mon|tue|wed|thu|fri|sat|sun)(,(mon|tue|wed|thu|fri|sat|sun))*)$/;
/** `HH:MM`. */
export const REMIND = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A box of a task's checklist. `id`: unique within the task, what a merge matches items by. */
export type ChecklistItem = { id: string; text: string; done: boolean };

export type Task = {
  /** The record id (15 of [a-z0-9], core/pocketbase.ts recordId), made by the client that adds it. */
  id: string;
  title: string;
  /** Markdown. */
  notes: string;
  checklist: ChecklistItem[];
  /** The scheduled day; a past one is Today. */
  when: string;
  /** This Evening: only with `when`. */
  evening: boolean;
  /** The deadline. */
  due: string;
  /** `1d 2w 1m 1y`, `+3d`, `mon,thu` (core/dates.ts nextOccurrence). */
  every: Every;
  /** `HH:MM` on the `when` day. */
  remind: string;
  /** The day it was ticked; "" while open. */
  done: string;
  /** Its place in whatever list it sits in, ascending. The notes it is about are links of their own (core/record-links.ts
   *  notesOfTask), not a field: they change without moving its `rev`. */
  order: number;
  /** Tag names (the same ones notes carry), each once ignoring case and tonos. Edited by hand and by the server's
   *  auto-tagger, both ordinary `rev` writes; two edits merge as a set. */
  tags: string[];
};

/** What patchTask changes; a key left out stays. Clearing `when` clears `evening`. */
export type TaskPatch = Partial<Omit<Task, "id">>;

const TASK: Omit<Task, "id" | "title"> = {
  notes: "", checklist: [], when: "", evening: false, due: "", every: "", remind: "", done: "", order: 0, tags: [],
};

/** The longest tag name the server's definitions take (pb_migrations/1792500000_tags.js). */
export const TAG_MAX = 40;

// ---- the wire

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
/** Tag names out of a column: the strings, one per name ignoring case. */
const names = (v: unknown): string[] => (Array.isArray(v) ? dedupeTags(v.filter((s): s is string => typeof s === "string")) : []);
const items = (v: unknown): ChecklistItem[] =>
  Array.isArray(v) ? v.filter((i) => i && typeof i === "object").map((i) => ({ id: str(i.id), text: str(i.text), done: !!i.done })) : [];

/** A task out of a server record (or anything shaped like one): unknown keys dropped, missing ones unset. */
export const taskOf = (r: any): Task => ({
  id: str(r.id), title: str(r.title), notes: str(r.notes), checklist: items(r.checklist), when: str(r.when), evening: !!r.evening,
  due: str(r.due), every: str(r.every), remind: str(r.remind), done: str(r.done), order: num(r.order),
  tags: names(r.tags),
});

// ---- making and changing

/** `list` trimmed, a leading `#` dropped, the empty ones gone, each name once ignoring case and tonos (the first spelling stays). */
export function dedupeTags(list: string[]): string[] {
  const out: string[] = [], seen = new Set<string>();
  for (const s of list) {
    const n = s.trim().replace(/^#/, "").trim(), k = fold(n);
    if (n && !seen.has(k)) { seen.add(k); out.push(n); }
  }
  return out;
}

/** `t` with `add` put on its tags (a name it has already is left as it is) and `remove` taken off, ignoring case. */
export const retagTask = (t: Task, add: string[], remove: string[] = []): Task => {
  const gone = remove.map(fold);
  return patchTask(t, { tags: [...t.tags.filter((x) => !gone.includes(fold(x))), ...add] });
};

/** One line: a title never holds a newline. */
const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();

function check(t: Task) {
  if (!t.title) throw new Error("A task needs a title.");
  for (const k of ["when", "due", "done"] as const) if (t[k] && !isDay(t[k])) throw new Error(`${k}: ${t[k]} is not a YYYY-MM-DD day.`);
  if (t.every && !EVERY.test(t.every)) throw new Error(`every: ${t.every} is not 1d, 2w, 1m, 1y, +3d or mon,thu.`);
  if (t.remind && !REMIND.test(t.remind)) throw new Error(`remind: ${t.remind} is not HH:MM.`);
  for (const g of t.tags) if (g.length > TAG_MAX || /[\r\n,]/.test(g)) throw new Error(`tags: "${g.slice(0, 20)}" is not a tag name (up to ${TAG_MAX} characters, no comma or line break).`);
}

/** The exclusion kept: `evening` needs a `when`. What a merge of two edits can break, so it is mended after one. */
export const normalizeTask = (t: Task): Task => ({ ...t, evening: t.evening && !!t.when, tags: dedupeTags(t.tags) });

/** A new open task. Throws on a value the server would refuse (an empty title, a day that isn't one). */
export function newTask(id: string, fields: TaskPatch & { title: string }): Task {
  const t = normalizeTask({ ...TASK, ...fields, id, title: oneLine(fields.title) });
  check(t);
  return t;
}

/** `t` with `p` applied, the exclusions kept; throws as newTask does. */
export function patchTask(t: Task, p: TaskPatch): Task {
  const n: Task = { ...t, ...p, id: t.id };
  if (p.tags) n.tags = dedupeTags(p.tags);
  if (p.title !== undefined) n.title = oneLine(p.title);
  if (p.evening && !n.when) throw new Error("evening needs a when.");
  check(n);
  return normalizeTask(n);
}

/** After the last of `list`: one more than the highest `order`. */
export const nextOrder = (list: { order: number }[]) => list.reduce((m, x) => Math.max(m, x.order + 1), 0);

// ---- ticking

/** Tick a task. One with `every` is done as it is, without `every` (only an open task repeats, so reopening the done
 *  copy never makes a second), and its next round comes back as `next`: a new record, the next `when` (a `due` moved
 *  by the same gap; a `due` alone moves itself; with neither, the next day is its `when`), checklist unticked. An
 *  already done task comes back as it was. `newId`: the next round's record id (recordId). */
export function complete(t: Task, today: string, newId: () => string): { task: Task; next?: Task } {
  if (t.done) return { task: t };
  if (!t.every) return { task: { ...t, done: today } };
  const day = nextOccurrence(t.every, t.when || t.due || today, today);
  const next: Task = { ...t, id: newId(), done: "", checklist: t.checklist.map((i) => ({ ...i, done: false })) };
  if (t.when) { next.when = day; if (t.due) next.due = addDays(day, daysBetween(t.when, t.due)); }
  else if (t.due) next.due = day;
  else next.when = day;
  return { task: { ...t, done: today, every: "" }, next: normalizeTask(next) };
}

/** Untick: open again, as it was. */
export const reopen = (t: Task): Task => ({ ...t, done: "" });

// ---- the checklist

const ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Four random characters no item of the checklist carries yet. */
function itemId(list: ChecklistItem[]): string {
  const taken = new Set(list.map((i) => i.id));
  for (;;) {
    let id = "";
    for (let i = 0; i < 4; i++) id += ALNUM[Math.floor(Math.random() * ALNUM.length)];
    if (!taken.has(id)) return id;
  }
}

/** A new open item at the end of the checklist. */
export const addItem = (t: Task, text: string): Task => ({ ...t, checklist: [...t.checklist, { id: itemId(t.checklist), text: oneLine(text), done: false }] });

/** An item's text or tick changed; the task as it was when there is no such item. */
export const setItem = (t: Task, id: string, p: Partial<Omit<ChecklistItem, "id">>): Task =>
  ({ ...t, checklist: t.checklist.map((i) => (i.id === id ? { ...i, ...p, id, ...(p.text !== undefined ? { text: oneLine(p.text) } : {}) } : i)) });

export const removeItem = (t: Task, id: string): Task => ({ ...t, checklist: t.checklist.filter((i) => i.id !== id) });

// ---- Things' lists

export type Views = {
  /** Open, unscheduled. */
  inbox: Task[];
  /** Open, `when` today or before (not This Evening), or due by today. */
  today: Task[];
  /** Today's This Evening ones. */
  evening: Task[];
  /** A later `when`, by day, soonest first. */
  upcoming: { day: string; tasks: Task[] }[];
  /** Done, the latest first. */
  logbook: Task[];
};

const byOrder = (a: Task, b: Task) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The lists, each by `order` (the Logbook by the day done). Today and the Inbox may share a task: an unscheduled one
 *  due today. */
export function views(tasks: Task[], today: string): Views {
  const v: Views = { inbox: [], today: [], evening: [], upcoming: [], logbook: [] };
  const later = new Map<string, Task[]>();
  for (const t of [...tasks].sort(byOrder)) {
    if (t.done) { v.logbook.push(t); continue; }
    if (t.when && t.when <= today) (t.evening ? v.evening : v.today).push(t);
    else if (t.due && t.due <= today) v.today.push(t);
    if (t.when > today) later.set(t.when, [...(later.get(t.when) ?? []), t]);
    else if (!t.when) v.inbox.push(t);
  }
  v.upcoming = [...later.keys()].sort().map((day) => ({ day, tasks: later.get(day)! }));
  v.logbook.sort((a, b) => (a.done < b.done ? 1 : a.done > b.done ? -1 : 0));
  return v;
}

// ---- merging

/** Equal as JSON values, whatever the key order (the server sends an object's keys sorted). */
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => equal(x, b[i]));
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** One value three ways: theirs where only they changed it, mine where only I did or we agree; both changed it
 *  differently is a conflict, mine kept. */
function pick<V>(base: V | undefined, mine: V, theirs: V, has: boolean): { value: V; conflict: boolean } {
  if (equal(mine, theirs) || (has && equal(theirs, base))) return { value: mine, conflict: false };
  if (has && equal(mine, base)) return { value: theirs, conflict: false };
  return { value: mine, conflict: true };
}

/** A list three ways, its items matched by `key`: an item added on either side is kept (theirs after the item before
 *  it in their list); removed on one side and untouched on the other, it goes; removed on one and changed on the
 *  other, the change stays (a conflict). Two edits of one item merge by `merge`. Mine's order wins. */
function mergeList<I>(base: I[], mine: I[], theirs: I[], key: (i: I) => string, merge: (b: I | undefined, m: I, t: I) => { value: I; conflict: boolean }) {
  const was = new Map(base.map((i) => [key(i), i])), mineAt = new Map(mine.map((i) => [key(i), i])), theirsAt = new Map(theirs.map((i) => [key(i), i]));
  let conflict = false;
  const out: I[] = [];
  for (const m of mine) {
    const k = key(m), t = theirsAt.get(k), b = was.get(k);
    if (t) { const r = merge(b, m, t); conflict ||= r.conflict; out.push(r.value); }
    else if (!b) out.push(m);                                            // added here
    else if (!equal(m, b)) { out.push(m); conflict = true; }           // removed there, changed here
  }
  theirs.forEach((t, i) => {
    const k = key(t), b = was.get(k);
    if (mineAt.has(k)) return;
    if (b && equal(t, b)) return;                                        // removed here, untouched there
    if (b) conflict = true;                                              // removed here, changed there
    const before = theirs.slice(0, i).reverse().find((x) => out.some((o) => key(o) === key(x)));
    out.splice(before ? out.findIndex((o) => key(o) === key(before)) + 1 : 0, 0, t);
  });
  return { value: out, conflict };
}

const mergeItem = (b: ChecklistItem | undefined, m: ChecklistItem, t: ChecklistItem) => {
  const text = pick(b?.text, m.text, t.text, !!b), done = pick(b?.done, m.done, t.done, !!b);
  return { value: { id: m.id, text: text.value, done: done.value }, conflict: text.conflict || done.conflict };
};

/** Names three ways as a set, ignoring case and tonos: one either side added is kept; one either side removed goes,
 *  whatever the other did (adding and removing are not in conflict, so never a conflict). Mine's order, then theirs'. */
function mergeNames(base: string[], mine: string[], theirs: string[]): string[] {
  const has = (list: string[], n: string) => list.some((x) => fold(x) === fold(n));
  const gone = (n: string) => has(base, n) && !(has(mine, n) && has(theirs, n));
  return dedupeTags([...mine, ...theirs].filter((n) => !gone(n)));
}

const isNames = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

const isChecklist = (v: unknown): v is ChecklistItem[] => Array.isArray(v) && v.every((i) => i && typeof i === "object" && typeof i.id === "string");

/** Two edits of one record, mine and theirs, against `base`, the version both started from (null: none in common,
 *  so every difference is a conflict). Field by field: each side's change is taken, and where both changed a field
 *  differently, mine is kept and the field named in `conflicts`. A checklist merges by item id, a list of names as a set. A task's exclusions may
 *  need mending after: normalizeTask. */
export function mergeRecord<T extends object>(base: T | null, mine: T, theirs: T): { merged: T; conflicts: string[] } {
  const b = base as Record<string, unknown> | null, m = mine as Record<string, unknown>, t = theirs as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...t, ...m }, conflicts: string[] = [];
  for (const k of Object.keys(merged)) {
    if (equal(m[k], t[k])) continue;
    const r = isChecklist(m[k]) && isChecklist(t[k]) ? mergeList(isChecklist(b?.[k]) ? b[k] : [], m[k], t[k], (i) => i.id, mergeItem)
        : isNames(m[k]) && isNames(t[k]) ? { value: mergeNames(isNames(b?.[k]) ? b[k] : [], m[k], t[k]), conflict: false }
        : pick(b?.[k], m[k], t[k], !!b && k in b);
    merged[k] = r.value;
    if (r.conflict) conflicts.push(k);
  }
  return { merged: merged as T, conflicts };
}
