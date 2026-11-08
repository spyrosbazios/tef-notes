// The offline-first sync engine: the logic the phone's two stores (mobile/src/store/notes.ts `syncNotes`, todo.ts
// `syncTodo`) hold, ported over a `Store` and a `Transport` so any client with a local copy can run it, and a bun test
// can run it against a fake server. The web app is its second user (web/src/lib/sync.ts); the phone still holds its own.
//
// The server is the source of truth; a client holds a copy plus unsent edits. Every write is made on the copy first
// (the `edit` helpers below), marks the row unsent, and a push sends it later, naming the `rev` it was based on (the write
// contract, ARCHITECTURE.md): a stale one is refused and settled here, never retried blind.
//   - Notes: pull = one listing of every `path, rev, kind`, then a fetch of those whose rev differs; a record gone from
//     the server and not edited here is dropped. Push = an update per unsent row at its rev, a create for a new one, a
//     delete at its rev for a tombstone. A stale rev (Conflict) is a 3-way line merge against `base` (`reconcile`):
//     disjoint edits merge and go up once more, overlap is a `conflict` the user settles (`keepMine`, `takeTheirs`).
//     A new note whose path the server has already moves aside to `-2`.
//   - Tasks: the same over records. A stale rev merges field by field against `base` (`mergeRecord`), the local edit
//     winning a field both changed, so there is never a conflict to settle.
//   - Links: a set of ids, no rev. Pulled after the tasks; an add is idempotent (the server's copy comes back, perhaps
//     under its own id, which the row takes), a remove is a tombstone, a 404 (an end gone from the server) drops the link.
// "Unsent" is `updated !== pushed` (both ms, `tick`ed so an edit in the same millisecond as a push still reads as unsent,
// and one made while a push is out stays unsent after it).
import { Conflict, type Entry, type Listed, type Remote, type Versioned } from "./pocketbase";
import { isNotePath, newNotePath, parseNote, reconcile, type NoteKind } from "./notes";
import { linksForNextRound, newLink, sameLink, type Link, type LinkEnd, type LinkRole } from "./record-links";
import { mergeRecord, normalizeTask, taskOf, type Task } from "./todo";

// ---- rows

/** A note as the client holds it. `rec`/`rev`: the server's record and version the text was last in step with (null until
 *  first pushed); `base`: that version's text, what both sides' edits are diffed against. `conflict_*`: the server's
 *  version while unsent edits overlap it. `lost`: the unsent text `takeTheirs` replaced, until restored or dismissed.
 *  `deleted`: a tombstone until the delete is pushed. */
export type NoteRow = {
  path: string; text: string; kind: NoteKind;
  updated: number; pushed: number | null;
  rec: string | null; rev: number | null; base: string | null;
  conflict_text: string | null; conflict_rev: number | null; lost: string | null;
  deleted: boolean;
};

/** A task as the client holds it: `data` now, `base` as of `rev` (null until first pushed or pulled). */
export type TaskRow = { id: string; data: Task; base: Task | null; rev: number | null; updated: number; pushed: number | null; deleted: boolean };

/** A link as the client holds it. `pushed`: when the server last had it (ms), null for one made here and not up yet. */
export type LinkRow = { link: Link; pushed: number | null; deleted: boolean };

/** One kind of row, by key. The engine reads and writes rows whole; `patch` below is the partial write. */
export type Table<R> = { get: (key: string) => R | undefined; all: () => R[]; put: (row: R) => void; delete: (key: string) => void };

/** The client's copy. A `put` must be visible to the next `get`: the engine reads its own writes. */
export type Store = { notes: Table<NoteRow>; tasks: Table<TaskRow>; links: Table<LinkRow> };

/** A note as fetched; `at`: the server's last change to it in ms, when the transport knows it (the phone orders a first pull by the
 *  note's `created` day instead). It is the row's `updated` when the note is first seen or taken, so the list's order is the server's. */
export type Fetched = Remote & { at?: number };

/** What the engine asks of the server, the core's `pocketbase.ts` calls with the server bound (the web wraps its axios services
 *  the same way). Every call rejects with `Conflict` for a stale rev or a taken name; `status` says what an error was. */
export type Transport = {
  notes: {
    list: () => Promise<Listed[]>;
    get: (rec: string) => Promise<Fetched | null>;
    read: (path: string) => Promise<Fetched | null>;
    create: (path: string, text: string) => Promise<Remote>;
    update: (e: Entry, text: string) => Promise<Remote | null>;
    remove: (e: Pick<Entry, "rec" | "rev">) => Promise<void>;
  };
  tasks: {
    revs: () => Promise<{ id: string; rev: number }[]>;
    get: (id: string) => Promise<Versioned<Task> | null>;
    getMany: (ids: string[]) => Promise<Versioned<Task>[]>;
    create: (t: Task) => Promise<Versioned<Task>>;
    update: (id: string, rev: number, fields: Partial<Omit<Task, "id">>) => Promise<Versioned<Task> | null>;
    remove: (id: string, rev: number) => Promise<void>;
  };
  links: {
    ids: () => Promise<string[]>;
    byIds: (ids: string[]) => Promise<Link[]>;
    add: (l: Link) => Promise<Link>;
    remove: (id: string) => Promise<void>;
  };
  /** The HTTP status an error carries; undefined when nothing answered (a timeout, a refused or dropped connection). */
  status: (e: unknown) => number | undefined;
};

// ---- small things

/** The next `updated` of a row: it only moves forward. */
export const tick = (n?: { updated: number } | null) => Math.max(Date.now(), (n?.updated ?? 0) + 1);

/** `n` at a time, in order. */
export async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]!); }));
}

/** `patch` of the row at `key`; the row, or undefined when there is none. */
export function patch<R>(t: Table<R>, key: string, p: Partial<R>): R | undefined {
  const r = t.get(key);
  if (!r) return undefined;
  const n = { ...r, ...p };
  t.put(n);
  return n;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Whether a note has edits not sent. */
export const unsent = (n: NoteRow) => n.updated !== n.pushed;
/** Whether a task has edits not sent. */
export const taskUnsent = (r: TaskRow) => r.updated !== r.pushed;

/** The notes the engine syncs. */
export type Want = (path: string) => boolean;

// ---- one sync at a time

/** A function that runs `run` one at a time: a call while it runs sets a flag and gets the running promise back, and when
 *  the run ends it runs once more. `running()` says whether one is out. The flag is cleared in `.finally()` on the stored
 *  promise: an async function that never awaits finishes before the line storing its promise does, so a `finally` inside it
 *  would clear nothing and every later call would return early (mobile/src/store/attachments.ts bit on this). */
export function coalesced(run: () => Promise<void>): (() => Promise<void>) & { running: () => boolean } {
  let current: Promise<void> | null = null, again = false;
  const go = (): Promise<void> => {
    if (current) { again = true; return current; }
    const p: Promise<void> = run().catch(() => {}).finally(() => {
      current = null;
      if (again) { again = false; void go(); }
    });
    current = p;
    return p;
  };
  return Object.assign(go, { running: () => current !== null });
}

// ---- the context of a run

/** What one run of the engine works with. `fail`: a failure to report (one record's, never fatal to the others). */
export type Run = {
  store: Store;
  api: Transport;
  fail: (what: string, e: unknown) => void;
  /** Rows changed: called after the pull and after the push, for a client to redraw from its copy. */
  changed?: () => void;
  /** A new note moved aside to `to` because `from` was taken: an open editor should follow it. */
  moved?: (from: string, to: string) => void;
  /** The notes this run syncs; notes only by default (`isNotePath`). */
  want?: Want;
};

const unreachable = (c: Run, e: unknown) => !(e instanceof Conflict) && c.api.status(e) === undefined;
const wants = (c: Run, path: string) => (c.want ?? isNotePath)(path);

/** Local midnight of the note's `created`, so a first pull lists notes by age, not all at "now". */
function createdAt(path: string, text: string) {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(parseNote(path, text).created);
  const t = d ? new Date(+d[1]!, +d[2]! - 1, +d[3]!).getTime() : NaN;
  return t > 0 && t < Date.now() ? t : Date.now();
}

// ---- notes: local edits

/** A new row for a note made here. */
export const freshNote = (path: string, text: string, updated: number): NoteRow => ({
  path, text, kind: "note", updated, pushed: null, rec: null, rev: null, base: null,
  conflict_text: null, conflict_rev: null, lost: null, deleted: false,
});

/** `text` written to the note at `path` (a new row when there is none): unsent until the next push. false when it was the text
 *  already. */
export function writeNote(s: Store, path: string, text: string): boolean {
  const n = s.notes.get(path);
  if (n && !n.deleted && n.text === text) return false;
  if (n) s.notes.put({ ...n, text, updated: tick(n), deleted: false });
  else s.notes.put(freshNote(path, text, tick()));
  return true;
}

/** Off the list: a tombstone for the push, or gone at once when the server never had it, unless a sync is out (`syncing`),
 *  whose first upload of it may yet land (the push then takes that back down). false when there was nothing to remove. */
export function removeNote(s: Store, path: string, syncing: boolean): boolean {
  const n = s.notes.get(path);
  if (!n || n.deleted) return false;
  if (n.rec || syncing) s.notes.put({ ...n, deleted: true, conflict_text: null, conflict_rev: null });
  else s.notes.delete(path);
  return true;
}

/** Settle a conflict by keeping the local text: it goes up at the server's rev, over the server's. */
export function keepMine(s: Store, path: string): boolean {
  const n = s.notes.get(path);
  if (n?.conflict_rev == null) return false;
  s.notes.put({ ...n, rev: n.conflict_rev, base: n.conflict_text, conflict_text: null, conflict_rev: null });
  return true;
}

/** Settle a conflict by taking the server's text; the local text is kept in `lost` to restore. */
export function takeTheirs(s: Store, path: string): boolean {
  const n = s.notes.get(path);
  if (n?.conflict_rev == null || n.conflict_text == null) return false;
  const t = tick(n);
  s.notes.put({ ...n, text: n.conflict_text, rev: n.conflict_rev, base: n.conflict_text, updated: t, pushed: t, conflict_text: null, conflict_rev: null, lost: n.text });
  return true;
}

/** Put back the text `takeTheirs` replaced (unsent again). */
export function restoreMine(s: Store, path: string): boolean {
  const n = s.notes.get(path);
  if (n?.lost == null) return false;
  s.notes.put({ ...n, text: n.lost, updated: tick(n), lost: null });
  return true;
}

/** Let the text `takeTheirs` replaced go. */
export function dismissLost(s: Store, path: string): boolean {
  const n = s.notes.get(path);
  if (n?.lost == null) return false;
  s.notes.put({ ...n, lost: null });
  return true;
}

// ---- notes: pull

/** The server's text into the row, unless typed into or deleted while the read was out (push sorts those out). true when
 *  the text changed. */
function takeNote(s: Store, r: Fetched): boolean {
  const { path, text, rec, rev, kind, at } = r, n = s.notes.get(path);
  if (n && (unsent(n) || n.deleted || n.conflict_rev != null)) return false;
  if (n && n.text === text) { s.notes.put({ ...n, rec, rev, base: text, kind }); return false; }
  if (n) { const t = Math.max(at ?? Date.now(), n.updated + 1); s.notes.put({ ...n, text, rec, rev, base: text, kind, updated: t, pushed: t }); }
  else { const t = at ?? createdAt(path, text); s.notes.put({ ...freshNote(path, text, t), rec, rev, base: text, kind, pushed: t }); }
  return true;
}

/** false when the server couldn't be reached: nothing else is worth trying this round. */
async function pullNotes(c: Run): Promise<boolean> {
  let down = false;
  const failed = (what: string, e: unknown) => { if (unreachable(c, e)) down = true; c.fail(what, e); };
  let entries: Listed[];
  try { entries = await c.api.notes.list(); } catch (e) { failed("notes", e); return !down; }
  const remote = new Map(entries.filter((e) => wants(c, e.path)).map((e) => [e.path, e]));
  const local = new Map(c.store.notes.all().filter((r) => wants(c, r.path)).map((r) => [r.path, r]));
  const stale = [...remote.values()].filter((e) => { const l = local.get(e.path); return !l || !(l.rev === e.rev || unsent(l) || l.deleted || l.conflict_rev != null); });
  await pool(stale, 6, async (e) => {
    if (down) return;                                              // each would wait out its own timeout
    try {
      const rem = await c.api.notes.get(e.rec);
      if (rem) takeNote(c.store, rem);
    } catch (err) { failed(e.path, err); }
  });
  // Gone from the server: removed here too, unless edited here since (push puts it back). A tombstone's delete is done.
  for (const path of local.keys()) {
    if (remote.has(path)) continue;
    const n = c.store.notes.get(path);
    if (n && (n.deleted || !unsent(n))) c.store.notes.delete(path);
  }
  // A kind never moves, but a copy pulled before it was kept has the rev and lacks it
  for (const r of c.store.notes.all()) { const e = remote.get(r.path); if (e && r.kind !== e.kind) c.store.notes.put({ ...r, kind: e.kind }); }
  return !down;
}

// ---- notes: push

/** A note made here whose path the server has already (another device made one by that name before this one pulled) moved to a
 *  free path: text and flags go along, the old row goes. `taken`: paths the server was found to hold. Returns the new path.
 *  The note's photos are not moved: the web never has one on a note not yet pushed (an upload needs the server). */
function moveAside(c: Run, path: string, n: NoteRow, taken: Set<string>): string {
  taken.add(path);
  const to = newNotePath(parseNote(path, n.text).title, createdAt(path, n.text), new Set([...c.store.notes.all().map((r) => r.path), ...taken]));
  c.store.notes.put({ ...n, path: to, updated: tick(n) });
  c.store.notes.delete(path);
  c.moved?.(path, to);
  return to;
}

/** One note up. A stale rev: same text or disjoint edits settle here (merged ones go out once more); overlap is a conflict. */
async function sendNote(c: Run, path: string, retry = true, taken = new Set<string>()): Promise<void> {
  const { api, store } = c;
  const n = store.notes.get(path);
  if (!n || n.deleted || !unsent(n) || n.conflict_rev != null) return;
  const at = n.updated;                                            // edits made mid-request stay unsent
  const done = async (r: Remote) => {
    const now = store.notes.get(path);
    // Deleted while it went up: a tombstone gets the record for drop to delete, next in this push; a row gone altogether is
    // taken down here, or the next pull would bring the note back
    if (!now) return api.notes.remove(r);
    if (now.deleted) return void store.notes.put({ ...now, rec: r.rec, rev: r.rev });
    store.notes.put({ ...now, rec: r.rec, rev: r.rev, base: n.text, pushed: at });
  };
  try {
    // Gone from the server since (deleted elsewhere) while edited here: the edit puts it back
    const r = (n.rec && n.rev != null ? await api.notes.update({ rec: n.rec, path, rev: n.rev }, n.text) : null) ?? await api.notes.create(path, n.text);
    return await done(r);
  } catch (e) {
    if (!(e instanceof Conflict)) throw e;
  }
  const rem = await api.notes.read(path);
  if (!rem) return done(await api.notes.create(path, n.text));    // deleted between the refusal and the read
  const cur = store.notes.get(path);
  if (!cur || cur.deleted) return;
  // Never pushed, and the server has the path: someone else's note, not this one's past to merge with. The same text is this
  // upload, landed once before the page closed; anything else, this note moves aside and goes up there
  if (cur.rec == null && isNotePath(path) && rem.text !== cur.text) return sendNote(c, moveAside(c, path, cur, taken), retry, taken);
  const m = reconcile(cur.base ?? undefined, cur.text, rem.text);
  if (m == null) {
    store.notes.put({ ...cur, rec: rem.rec, conflict_text: rem.text, conflict_rev: rem.rev });
    return;
  }
  store.notes.put({ ...cur, text: m, rec: rem.rec, rev: rem.rev, base: rem.text, ...(m === rem.text ? { pushed: cur.updated } : {}) });
  if (m !== rem.text && retry) await sendNote(c, path, false, taken);
}

/** One tombstone. Edited on the server since this client last saw it: that edit outlives the delete, and the note comes back
 *  with it. */
async function dropNote(c: Run, t: NoteRow): Promise<void> {
  const { api, store } = c;
  const gone = () => { if (store.notes.get(t.path)?.deleted) store.notes.delete(t.path); };   // unless written to again meanwhile
  if (!t.rec || t.rev == null) return gone();
  try {
    await api.notes.remove({ rec: t.rec, rev: t.rev });
    return gone();
  } catch (e) {
    if (!(e instanceof Conflict)) throw e;
  }
  const rem = await api.notes.get(t.rec);
  if (!rem) return gone();
  if (!store.notes.get(t.path)?.deleted) return;
  const u = tick(t);
  store.notes.put({ ...t, text: rem.text, rev: rem.rev, base: rem.text, updated: u, pushed: u, deleted: false });
}

async function pushNotes(c: Run) {
  const mine = () => c.store.notes.all().filter((n) => wants(c, n.path));
  for (const n of mine()) if (!n.deleted && unsent(n) && n.conflict_rev == null) await sendNote(c, n.path).catch((e) => c.fail(n.path, e));
  for (const n of mine()) if (n.deleted) await dropNote(c, n).catch((e) => c.fail(n.path, e));
}

// ---- tasks: local edits

/** One task's fields written here: unsent until the next push. */
export function saveTask(s: Store, data: Task): void {
  const r = s.tasks.get(data.id);
  if (r && !r.deleted && same(r.data, data)) return;
  if (r) s.tasks.put({ ...r, data, updated: tick(r), deleted: false });
  else s.tasks.put({ id: data.id, data, base: null, rev: null, updated: tick(), pushed: null, deleted: false });
}

/** A tombstone for the push, or gone at once when the server never had it, unless a sync is out. */
export function removeTask(s: Store, id: string, syncing: boolean): void {
  const r = s.tasks.get(id);
  if (!r || r.deleted) return;
  if (r.rev != null || syncing) s.tasks.put({ ...r, deleted: true });
  else s.tasks.delete(id);
}

// ---- tasks: pull and push

function takeTask(s: Store, r: Versioned<Task>) {
  const { rev, ...fields } = r, data = taskOf(fields), n = s.tasks.get(data.id);
  if (n && (taskUnsent(n) || n.deleted)) return;
  const t = tick(n);
  s.tasks.put({ id: data.id, data, base: data, rev, updated: t, pushed: t, deleted: false });
}

/** false when the server couldn't be reached. */
async function pullTasks(c: Run): Promise<boolean> {
  const { api, store } = c;
  let entries: { id: string; rev: number }[];
  try { entries = await api.tasks.revs(); } catch (e) { c.fail("tasks", e); return !unreachable(c, e); }
  const remote = new Set(entries.map((e) => e.id)), local = new Map(store.tasks.all().map((r) => [r.id, r]));
  const stale = entries.filter((e) => { const l = local.get(e.id); return !l || (l.rev !== e.rev && !taskUnsent(l) && !l.deleted); }).map((e) => e.id);
  try { for (const r of await api.tasks.getMany(stale)) takeTask(store, r); } catch (e) { c.fail("tasks", e); if (unreachable(c, e)) return false; }
  // Gone from the server: gone here too, unless edited here since (the push puts it back). A tombstone's delete is done.
  for (const l of local.values()) if (l.rev != null && !remote.has(l.id) && (l.deleted || !taskUnsent(l))) store.tasks.delete(l.id);
  return true;
}

/** One task up. A stale rev: merged with the server's (the local edit winning a field both changed) and sent once more, unless
 *  the merge is the server's version already. */
async function sendTask(c: Run, id: string, retry = true): Promise<void> {
  const { api, store } = c;
  const n = store.tasks.get(id);
  if (!n || n.deleted || !taskUnsent(n)) return;
  const at = n.updated, out = normalizeTask(taskOf(n.data));
  if (!same(out, n.data)) store.tasks.put({ ...n, data: out });
  const done = async (r: Versioned<Task>) => {
    const now = store.tasks.get(id), { rev, ...fields } = r, base = taskOf(fields);
    if (!now) return api.tasks.remove(id, rev);                    // dropped here while it went up
    store.tasks.put(now.deleted ? { ...now, rev, base } : { ...now, rev, base, pushed: at });
  };
  const { id: _, ...fields } = out;
  try {
    const r = (n.rev != null ? await api.tasks.update(id, n.rev, fields) : null) ?? await api.tasks.create(out);
    return await done(r);
  } catch (e) {
    if (!(e instanceof Conflict)) throw e;
  }
  // Moved on since; or, for a create, this upload landed once before the page closed (no base: every difference is local)
  const rem = await api.tasks.get(id);
  if (!rem) return done(await api.tasks.create(out));
  const cur = store.tasks.get(id);
  if (!cur || cur.deleted) return;
  const { rev, ...rest } = rem, theirs = taskOf(rest);
  const merged = normalizeTask(mergeRecord(cur.base == null ? null : taskOf(cur.base), taskOf(cur.data), theirs).merged);
  const clean = same(merged, theirs);
  store.tasks.put({ ...cur, data: merged, base: theirs, rev, ...(clean ? { pushed: cur.updated } : {}) });
  if (!clean && retry) await sendTask(c, id, false);
}

/** One tombstone. Edited on the server since this client last saw it: that edit outlives the delete, and it comes back. */
async function dropTask(c: Run, t: TaskRow): Promise<void> {
  const { api, store } = c;
  const gone = () => { if (store.tasks.get(t.id)?.deleted) store.tasks.delete(t.id); };
  if (t.rev == null) return gone();
  try {
    await api.tasks.remove(t.id, t.rev);
    return gone();
  } catch (e) {
    if (!(e instanceof Conflict)) throw e;
  }
  const rem = await api.tasks.get(t.id);
  if (!rem) return gone();
  if (!store.tasks.get(t.id)?.deleted) return;
  const { rev, ...fields } = rem, data = taskOf(fields), u = tick(t);
  store.tasks.put({ id: t.id, data, base: data, rev, updated: u, pushed: u, deleted: false });
}

const pushTasks = (c: Run) =>
  pool(c.store.tasks.all().filter((r) => !r.deleted && taskUnsent(r)), 4, (r) => sendTask(c, r.id).catch((e) => c.fail(`tasks/${r.id}`, e)));

const dropTasks = (c: Run) =>
  pool(c.store.tasks.all().filter((r) => r.deleted), 4, (t) => dropTask(c, t).catch((e) => c.fail(`tasks/${t.id}`, e)));

// ---- links: local edits

/** Whether a link's task ends (if any) are among the tasks held and not deleted. */
const endsHere = (s: Store, l: Link) => [l.from, l.to].every((e) => e.type !== "task" || (!!s.tasks.get(e.id) && !s.tasks.get(e.id)!.deleted));

/** The links to show: not deleted, and naming no task that is gone here. Oldest first. */
export const visibleLinks = (s: Store): Link[] => s.links.all().filter((r) => !r.deleted && endsHere(s, r.link)).map((r) => r.link);

/** Every link not deleted here, its task there or not. */
const liveLinks = (s: Store): Link[] => s.links.all().filter((r) => !r.deleted).map((r) => r.link);

/** `from` linked to `to` as `role` (newLink throws on one it refuses; `id` names it); the id of the link, the one already
 *  held when this relation is. */
export function addLink(s: Store, id: string, from: LinkEnd, to: LinkEnd, role: LinkRole): string {
  const want = newLink(id, from, to, role);
  const had = s.links.all().find((r) => sameLink(r.link, want));
  if (had && !had.deleted) return had.link.id;
  s.links.put(had ? { ...had, deleted: false } : { link: want, pushed: null, deleted: false });
  return had ? had.link.id : want.id;
}

/** A link gone: a tombstone for the push when the server had it (or a sync is out), else at once. */
export function removeLink(s: Store, id: string, syncing: boolean): void {
  const r = s.links.get(id);
  if (!r || r.deleted) return;
  if (r.pushed != null || syncing) s.links.put({ ...r, deleted: true });
  else s.links.delete(id);
}

/** A repeating task ticked (core/todo.ts complete): its next round gets the links of the one done, each under a new id. */
export function carryLinks(s: Store, taskId: string, nextId: string, newId: () => string): void {
  for (const link of linksForNextRound(liveLinks(s), taskId, nextId, newId)) s.links.put({ link, pushed: null, deleted: false });
}

// ---- links: pull and push

/** How many ids one fetch names in its filter. */
const LINK_BATCH = 40;

/** "down" when the server couldn't be reached; "failed" when it answered badly (a server without links yet answers 404), so
 *  nothing is pushed this round: every add would be refused and dropped as if its end were gone. */
async function pullLinks(c: Run): Promise<"ok" | "failed" | "down"> {
  const { api, store } = c;
  let ids: string[];
  try { ids = await api.links.ids(); } catch (e) { c.fail("links", e); return unreachable(c, e) ? "down" : "failed"; }
  const remote = new Set(ids), rows = new Map(store.links.all().map((r) => [r.link.id, r]));
  const missing = ids.filter((id) => !rows.has(id));
  try {
    for (let i = 0; i < missing.length; i += LINK_BATCH) {
      for (const link of await api.links.byIds(missing.slice(i, i + LINK_BATCH))) if (!store.links.get(link.id)) store.links.put({ link, pushed: Date.now(), deleted: false });
    }
  } catch (e) { c.fail("links", e); return unreachable(c, e) ? "down" : "failed"; }
  for (const r of rows.values()) {
    if (remote.has(r.link.id)) { if (r.pushed == null) store.links.put({ ...r, pushed: Date.now() }); }   // an add that landed before the page closed
    else if (r.pushed != null) store.links.delete(r.link.id);       // gone from the server; a tombstone's delete is done
  }
  return "ok";
}

/** A task end's record: "here" on the server, "pending" made here and not up yet, "gone" not held. */
function taskEnd(s: Store, id: string): "here" | "pending" | "gone" {
  const r = s.tasks.get(id);
  return !r || r.deleted ? "gone" : r.rev == null ? "pending" : "here";
}

async function pushLinks(c: Run) {
  const { api, store } = c;
  for (const r of store.links.all()) {
    const l = r.link, id = l.id;
    try {
      if (r.deleted) {
        await api.links.remove(id);
        if (store.links.get(id)?.deleted) store.links.delete(id);
        continue;
      }
      if (r.pushed != null) continue;
      const ends = [l.from, l.to].filter((e) => e.type === "task").map((e) => taskEnd(store, e.id));
      if (ends.includes("gone")) { store.links.delete(id); continue; }   // its task deleted here: the server's cascade sees to its copy
      if (ends.includes("pending")) continue;                          // its task didn't go up this round: next time
      const got = await api.links.add(l), now = store.links.get(id);
      if (!now) { await api.links.remove(got.id); continue; }
      if (got.id !== id) store.links.delete(id);                       // the server had this relation under its own id
      store.links.put({ link: got, pushed: Date.now(), deleted: now.deleted });
    } catch (e) {
      if (!(e instanceof Conflict) && c.api.status(e) === 404 && !r.deleted) store.links.delete(id);   // an end is gone from the server
      else c.fail(`links/${id}`, e);
    }
  }
}

// ---- a round

/** Pull then push, every record on its own: one failure holds back nothing else. Notes first, then tasks, then the links that
 *  name them. A server that can't be reached ends the round after the pull. true when the server was reached. */
export async function syncRound(c: Run): Promise<boolean> {
  if (!(await pullNotes(c))) return false;
  c.changed?.();
  await pushNotes(c);
  if (!(await pullTasks(c))) return false;
  const links = await pullLinks(c);
  if (links === "down") return false;
  c.changed?.();
  await pushTasks(c);
  if (links === "ok") await pushLinks(c);
  await dropTasks(c);
  c.changed?.();
  return true;
}

// ---- what the client shows of it

/** Rows with changes not sent: unsent or deleted notes, tasks and links. */
export function waiting(s: Store): number {
  return s.notes.all().filter((n) => unsent(n) || n.deleted).length
    + s.tasks.all().filter((t) => taskUnsent(t) || t.deleted).length
    + s.links.all().filter((l) => l.pushed == null || l.deleted).length;
}

/** The paths of notes whose edits overlap the server's, waiting on a side being picked or on replaced text being restored. */
export const conflicted = (s: Store): string[] => s.notes.all().filter((n) => !n.deleted && (n.conflict_rev != null || n.lost != null)).map((n) => n.path);
