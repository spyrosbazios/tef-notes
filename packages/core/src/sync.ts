// The offline-first sync engine, over a `Store` and a `Transport` so any client with a local copy can run it (the web app:
// web/src/lib/sync.ts), and a bun test can run it against a fake server.
//
// The server is the source of truth; a client holds a copy plus unsent edits. Every write is made on the copy first
// (the `edit` helpers below), marks the row unsent, and a push sends it later, naming the `rev` it was based on (the write
// contract, ARCHITECTURE.md): a stale one is refused and settled here, never retried blind.
//   - Notes: pull = one listing of every `rec, path, rev, kind`, then a fetch of those whose record or rev differs (a note
//     deleted and made again at the same path elsewhere is another record); a record gone from the server and not edited
//     here is dropped. Push = an update per unsent row at its rev, a create under the row's own record id (`recordId`, made
//     with the note) for a new one, a delete at its rev for a tombstone. A stale rev (Conflict) is a 3-way line merge against
//     `base` (`reconcile`): disjoint edits merge and go up once more, overlap is a `conflict` the user settles (`keepMine`,
//     `takeTheirs`). A create refused as a Conflict is read back by its record id: there, it landed before (its reply was
//     lost); not there, another note holds the path, and this one moves aside to `-2`.
//   - Tasks: the same over records. A stale rev merges field by field against `base` (`mergeRecord`), the local edit
//     winning a field both changed, so there is never a conflict to settle.
//   - Links: a set of ids, no rev. Pulled after the tasks; an add is idempotent (the server's copy comes back, perhaps
//     under its own id, which the row takes), a remove is a tombstone, `Gone` (an end gone from the server) drops the link.
// "Unsent" is `updated !== pushed` (both ms, `tick`ed so an edit in the same millisecond as a push still reads as unsent,
// and one made while a push is out stays unsent after it).
// When: a full round (pull, then push) when the client may have missed something (it opened, its realtime feed came back after
// a gap); a push alone after an edit (`syncRound`'s `pull: false`). What another device changed meanwhile comes one record at a
// time from the server's realtime feed (`takeHeard`), rev-checked as a pull of that record would be.
// A failure is one of the transport's typed outcomes (record-contracts): `Unavailable` is tried again later, `Refused` parks
// the row (`refused`, its reason): it is not sent again until it is edited or the owner asks (`retryRefused`, `discardRefused`).
// A note written with text the owner didn't write (a model's summary) carries the `tainted` mark (`Mark`) on the row until a
// push has sent it; the server never takes the mark off (server/pb_hooks/tainted.pb.js), so it is sent once.
import { Conflict, Gone, Refused, Unavailable, type Entry, type Listed, type Mark, type Remote, type Versioned } from "./record-contracts";
import { isNotePath, newNotePath, parseNote, reconcile, type NoteKind } from "./notes";
import { newLink, sameLink, type Link, type LinkEnd, type LinkRole } from "./record-links";
import { mergeRecord, normalizeTask, taskOf, type Task } from "./todo";

// ---- rows

/** A note as the client holds it. `rec`: its record id, made here for a note made here (`recordId`) and sent with its create;
 *  `rev`: the server's version the text was last in step with (null until first pushed); `base`: that version's text, what
 *  both sides' edits are diffed against. `conflict_*`: the server's
 *  version while unsent edits overlap it. `lost`: the unsent text `takeTheirs` replaced, until restored or dismissed.
 *  `deleted`: a tombstone until the delete is pushed. `refused`: why the server refused its change, which then waits for
 *  the owner (every row kind has it). `tainted`: the unsent text holds someone else's (a model's), to go up with the mark. */
export type NoteRow = {
  path: string; text: string; kind: NoteKind;
  updated: number; pushed: number | null;
  rec: string; rev: number | null; base: string | null;
  conflict_text: string | null; conflict_rev: number | null; lost: string | null;
  deleted: boolean; refused?: string; tainted?: true;
};

/** A task as the client holds it: `data` now, `base` as of `rev` (null until first pushed or pulled). */
export type TaskRow = { id: string; data: Task; base: Task | null; rev: number | null; updated: number; pushed: number | null; deleted: boolean; refused?: string };

/** A link as the client holds it. `pushed`: when the server last had it (ms), null for one made here and not up yet. */
export type LinkRow = { link: Link; pushed: number | null; deleted: boolean; refused?: string };

/** One kind of row, by key. The engine reads and writes rows whole; `patch` below is the partial write. */
export type Table<R> = { get: (key: string) => R | undefined; all: () => R[]; put: (row: R) => void; delete: (key: string) => void };

/** The client's copy. A `put` must be visible to the next `get`: the engine reads its own writes. */
export type Store = { notes: Table<NoteRow>; tasks: Table<TaskRow>; links: Table<LinkRow> };

/** A note as fetched; `at`: the server's last change to it in ms, when the transport knows it (the phone orders a first pull by the
 *  note's `created` day instead). It is the row's `updated` when the note is first seen or taken, so the list's order is the server's. */
export type Fetched = Remote & { at?: number };

/** What the engine asks of the server, the core client's calls (`client/pocketbase.ts`) with the server bound (the web wraps its axios services
 *  the same way). Every call rejects with a typed outcome of record-contracts (record-protocol maps PocketBase's answers to
 *  them): `Conflict` for a stale rev or a taken name, `Gone`, `Refused`, `Unavailable`. */
export type Transport = {
  notes: {
    list: () => Promise<Listed[]>;
    get: (rec: string) => Promise<Fetched | null>;
    create: (rec: string, path: string, text: string, mark: Mark) => Promise<Remote>;
    update: (e: Entry, text: string, mark: Mark) => Promise<Remote | null>;
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

// ---- one sync at a time

/** A function that runs `run` one at a time. A call while it runs asks for one more run after it and gets that rerun's promise
 *  (every caller arriving mid-run shares the one rerun): a caller that awaits a sync to see a write made just now sees a round
 *  that started after it, never the round already out. `running()` says whether one is out. `current` is cleared in
 *  `.finally()` on the stored promise: an async function that never awaits finishes before the line storing its promise does,
 *  so a `finally` inside it would clear nothing and every later call would return early (the phone app this was ported from
 *  bit on this). The rerun chains on that same stored promise, so it starts after `current` is cleared. */
export function coalesced(run: () => Promise<void>): (() => Promise<void>) & { running: () => boolean } {
  let current: Promise<void> | null = null, next: Promise<void> | null = null;
  const go = (): Promise<void> => {
    if (current) return (next ??= current.then(() => { next = null; return go(); }));
    const p: Promise<void> = run().catch(() => {}).finally(() => { current = null; });
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
};

const unreachable = (e: unknown) => e instanceof Unavailable;

/** Local midnight of the note's `created`, so a first pull lists notes by age, not all at "now". */
function createdAt(path: string, text: string) {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(parseNote(path, text).created);
  const t = d ? new Date(+d[1]!, +d[2]! - 1, +d[3]!).getTime() : NaN;
  return t > 0 && t < Date.now() ? t : Date.now();
}

// ---- notes: local edits

/** A new row for a note under the record id `rec`, not yet on the server. */
export const freshNote = (rec: string, path: string, text: string, updated: number): NoteRow => ({
  path, text, kind: "note", updated, pushed: null, rec, rev: null, base: null,
  conflict_text: null, conflict_rev: null, lost: null, deleted: false,
});

/** A note made here, under its own record id (`recordId`), at a path this copy doesn't hold: unsent until the next push. */
export function addNote(s: Store, rec: string, path: string, text: string, mark: Mark = {}): void {
  if (s.notes.get(path)) throw new Error(`${path} is taken`);
  s.notes.put({ ...freshNote(rec, path, text, tick()), ...(mark.tainted ? { tainted: true as const } : {}) });
}

/** `text` written to the note at `path`: unsent until the next push, with `mark` (a row once tainted stays so until sent).
 *  false when it was the text already, or there is no such note (a new one is `addNote`'s). */
export function writeNote(s: Store, path: string, text: string, mark: Mark = {}): boolean {
  const n = s.notes.get(path);
  if (!n || (!n.deleted && n.text === text)) return false;
  s.notes.put({ ...n, text, updated: tick(n), deleted: false, refused: undefined, ...(mark.tainted ? { tainted: true as const } : {}) });
  return true;
}

/** Off the list: a tombstone for the push, or gone at once when the server never had it, unless a sync is out (`syncing`),
 *  whose first upload of it may yet land (the push then takes that back down). false when there was nothing to remove. */
export function removeNote(s: Store, path: string, syncing: boolean): boolean {
  const n = s.notes.get(path);
  if (!n || n.deleted) return false;
  if (n.rev != null || syncing) s.notes.put({ ...n, deleted: true, conflict_text: null, conflict_rev: null, refused: undefined });
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

/** The server's text into the row, unless typed into or deleted while the read was out (push sorts those out). Another record
 *  at the row's path (deleted and made again elsewhere) replaces the row's record and base with its own. true when the text
 *  changed. */
function takeNote(s: Store, r: Fetched): boolean {
  const { path, text, rec, rev, kind, at } = r, n = s.notes.get(path);
  if (n && (unsent(n) || n.deleted || n.conflict_rev != null)) return false;
  if (n && n.text === text) { s.notes.put({ ...n, rec, rev, base: text, kind }); return false; }
  if (n) { const t = Math.max(at ?? Date.now(), n.updated + 1); s.notes.put({ ...n, text, rec, rev, base: text, kind, updated: t, pushed: t }); }
  else { const t = at ?? createdAt(path, text); s.notes.put({ ...freshNote(rec, path, text, t), rev, base: text, kind, pushed: t }); }
  return true;
}

/** false when the server couldn't be reached: nothing else is worth trying this round. */
async function pullNotes(c: Run): Promise<boolean> {
  let down = false;
  const failed = (what: string, e: unknown) => { if (unreachable(e)) down = true; c.fail(what, e); };
  let entries: Listed[];
  try { entries = await c.api.notes.list(); } catch (e) { failed("notes", e); return !down; }
  const remote = new Map(entries.filter((e) => isNotePath(e.path)).map((e) => [e.path, e]));
  const local = new Map(c.store.notes.all().filter((r) => isNotePath(r.path)).map((r) => [r.path, r]));
  const stale = [...remote.values()].filter((e) => {
    const l = local.get(e.path);
    return !l || !((l.rec === e.rec && l.rev === e.rev) || unsent(l) || l.deleted || l.conflict_rev != null);
  });
  await pool(stale, 6, async (e) => {
    if (down) return;                                              // each would wait out its own timeout
    try {
      const rem = await c.api.notes.get(e.rec);
      if (rem) takeNote(c.store, rem);
    } catch (err) { failed(e.path, err); }
  });
  // Gone from the server: removed here too, unless edited here since (push puts it back) or holding text `takeTheirs`
  // replaced, which waits for the owner (`restoreMine` puts it back up). A tombstone's delete is done.
  for (const path of local.keys()) {
    if (remote.has(path)) continue;
    const n = c.store.notes.get(path);
    if (n && (n.deleted || (!unsent(n) && n.lost == null))) c.store.notes.delete(path);
  }
  // A kind never moves, but a copy pulled before it was kept has the rev and lacks it
  for (const r of c.store.notes.all()) { const e = remote.get(r.path); if (e && r.kind !== e.kind) c.store.notes.put({ ...r, kind: e.kind }); }
  return !down;
}

// ---- notes: push

/** A note made here whose path the server has already (another device made one by that name before this one pulled) moved to a
 *  free path: text, flags and record id go along, the old row goes. `taken`: paths the server was found to hold. Returns the
 *  new path. Nothing is filed under the old path's id: a note's attachments go on only once it is on the server (the web's
 *  `landed`), and a path the server holds never changes. */
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
  if (!n || n.deleted || !unsent(n) || n.conflict_rev != null || n.refused != null) return;
  const at = n.updated;                                            // edits made mid-request stay unsent
  const mark: Mark = n.tainted ? { tainted: true } : {};
  const done = async (r: Remote) => {
    const now = store.notes.get(path);
    // Deleted while it went up: a tombstone gets the record for drop to delete, next in this push; a row gone altogether is
    // taken down here, or the next pull would bring the note back
    if (!now) return api.notes.remove(r);
    // The mark went up with it: the server keeps it from now on (one written mid-request is the server's already too)
    const sent = mark.tainted ? { tainted: undefined } : {};
    if (now.deleted) return void store.notes.put({ ...now, rec: r.rec, rev: r.rev, ...sent });
    store.notes.put({ ...now, rec: r.rec, rev: r.rev, base: n.text, pushed: at, ...sent });
  };
  try {
    // Gone from the server since (deleted elsewhere) while edited here: the edit puts it back, under the same record id
    const r = (n.rev != null ? await api.notes.update({ rec: n.rec, path, rev: n.rev }, n.text, mark) : null) ?? await api.notes.create(n.rec, path, n.text, mark);
    return await done(r);
  } catch (e) {
    if (!(e instanceof Conflict)) throw e;
  }
  // A stale rev, or a create refused for its record id or its path: the record says which
  const rem = await api.notes.get(n.rec);
  const cur = store.notes.get(path);
  if (!cur || cur.deleted) return;
  // Not on the server: the path is another record's (another device made a note by that name), and this one moves aside
  if (!rem) return sendNote(c, moveAside(c, path, cur, taken), retry, taken);
  // On the server and never in step here: this create landed before, its reply lost. What landed is an earlier text of this
  // note, so every difference is the local edit
  const base = cur.rev == null ? rem.text : cur.base;
  const m = reconcile(base ?? undefined, cur.text, rem.text);
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
  if (t.rev == null) return gone();
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
  const mine = () => c.store.notes.all().filter((n) => isNotePath(n.path) && n.refused == null);
  const failed = (path: string) => (e: unknown) => (e instanceof Refused ? void patch(c.store.notes, path, { refused: e.message }) : c.fail(path, e));
  for (const n of mine()) if (!n.deleted && unsent(n) && n.conflict_rev == null) await sendNote(c, n.path).catch(failed(n.path));
  for (const n of mine()) if (n.deleted) await dropNote(c, n).catch(failed(n.path));
}

// ---- tasks: local edits

/** One task's fields written here: unsent until the next push. */
export function saveTask(s: Store, data: Task): void {
  const r = s.tasks.get(data.id);
  if (r && !r.deleted && same(r.data, data)) return;
  if (r) s.tasks.put({ ...r, data, updated: tick(r), deleted: false, refused: undefined });
  else s.tasks.put({ id: data.id, data, base: null, rev: null, updated: tick(), pushed: null, deleted: false });
}

/** A tombstone for the push, or gone at once when the server never had it, unless a sync is out. */
export function removeTask(s: Store, id: string, syncing: boolean): void {
  const r = s.tasks.get(id);
  if (!r || r.deleted) return;
  if (r.rev != null || syncing) s.tasks.put({ ...r, deleted: true, refused: undefined });
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
  try { entries = await api.tasks.revs(); } catch (e) { c.fail("tasks", e); return !unreachable(e); }
  const remote = new Set(entries.map((e) => e.id)), local = new Map(store.tasks.all().map((r) => [r.id, r]));
  const stale = entries.filter((e) => { const l = local.get(e.id); return !l || (l.rev !== e.rev && !taskUnsent(l) && !l.deleted); }).map((e) => e.id);
  try { for (const r of await api.tasks.getMany(stale)) takeTask(store, r); } catch (e) { c.fail("tasks", e); if (unreachable(e)) return false; }
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

const taskFailed = (c: Run, id: string) => (e: unknown) =>
  (e instanceof Refused ? void patch(c.store.tasks, id, { refused: e.message }) : c.fail(`tasks/${id}`, e));

const pushTasks = (c: Run) =>
  pool(c.store.tasks.all().filter((r) => !r.deleted && taskUnsent(r) && r.refused == null), 4, (r) => sendTask(c, r.id).catch(taskFailed(c, r.id)));

const dropTasks = (c: Run) =>
  pool(c.store.tasks.all().filter((r) => r.deleted && r.refused == null), 4, (t) => dropTask(c, t).catch(taskFailed(c, t.id)));

// ---- links: local edits

/** Whether a link's task ends (if any) are among the tasks held and not deleted. */
const endsHere = (s: Store, l: Link) => [l.from, l.to].every((e) => e.type !== "task" || (!!s.tasks.get(e.id) && !s.tasks.get(e.id)!.deleted));

/** The links to show: not deleted, and naming no task that is gone here. Oldest first. */
export const visibleLinks = (s: Store): Link[] => s.links.all().filter((r) => !r.deleted && endsHere(s, r.link)).map((r) => r.link);

/** Every link not deleted here, its task there or not: what a repeating task's next round is linked from (changes.ts). */
export const liveLinks = (s: Store): Link[] => s.links.all().filter((r) => !r.deleted).map((r) => r.link);

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
  if (r.pushed != null || syncing) s.links.put({ ...r, deleted: true, refused: undefined });
  else s.links.delete(id);
}


// ---- links: pull and push

/** How many ids one fetch names in its filter. */
const LINK_BATCH = 40;

/** "down" when the server couldn't be reached; "failed" when it answered badly (a server without links yet answers 404), so
 *  nothing is pushed this round: every add would be refused and dropped as if its end were gone. */
async function pullLinks(c: Run): Promise<"ok" | "failed" | "down"> {
  const { api, store } = c;
  let ids: string[];
  try { ids = await api.links.ids(); } catch (e) { c.fail("links", e); return unreachable(e) ? "down" : "failed"; }
  const remote = new Set(ids), rows = new Map(store.links.all().map((r) => [r.link.id, r]));
  const missing = ids.filter((id) => !rows.has(id));
  try {
    for (let i = 0; i < missing.length; i += LINK_BATCH) {
      for (const link of await api.links.byIds(missing.slice(i, i + LINK_BATCH))) if (!store.links.get(link.id)) store.links.put({ link, pushed: Date.now(), deleted: false });
    }
  } catch (e) { c.fail("links", e); return unreachable(e) ? "down" : "failed"; }
  for (const r of rows.values()) {
    if (remote.has(r.link.id)) { if (r.pushed == null) store.links.put({ ...r, pushed: Date.now() }); }   // an add that landed before the page closed
    else if (r.pushed != null) store.links.delete(r.link.id);       // gone from the server; a tombstone's delete is done
  }
  return "ok";
}

/** A link end's record: "here" on the server, "pending" made here and not up yet, "gone" deleted here or, for a task, not
 *  held. A note not held here is the server's to judge (`Gone` if it has none). */
function endOf(s: Store, e: LinkEnd): "here" | "pending" | "gone" {
  if (e.type === "task") {
    const r = s.tasks.get(e.id);
    return !r || r.deleted ? "gone" : r.rev == null ? "pending" : "here";
  }
  const n = s.notes.all().find((x) => x.rec === e.id);
  return !n ? "here" : n.deleted ? "gone" : n.rev == null ? "pending" : "here";
}

async function pushLinks(c: Run) {
  const { api, store } = c;
  for (const r of store.links.all()) {
    const l = r.link, id = l.id;
    if (r.refused != null) continue;
    try {
      if (r.deleted) {
        await api.links.remove(id);
        if (store.links.get(id)?.deleted) store.links.delete(id);
        continue;
      }
      if (r.pushed != null) continue;
      const ends = [l.from, l.to].map((e) => endOf(store, e));
      if (ends.includes("gone")) { store.links.delete(id); continue; }   // an end deleted here: the server's cascade sees to its copy
      if (ends.includes("pending")) continue;                          // an end didn't go up this round: next time
      const got = await api.links.add(l), now = store.links.get(id);
      if (!now) { await api.links.remove(got.id); continue; }
      if (got.id !== id) store.links.delete(id);                       // the server had this relation under its own id
      store.links.put({ link: got, pushed: Date.now(), deleted: now.deleted });
    } catch (e) {
      if (e instanceof Gone && !r.deleted) store.links.delete(id);       // an end is gone from the server (deleted elsewhere)
      else if (e instanceof Refused) patch(store.links, id, { refused: e.message });
      else c.fail(`links/${id}`, e);
    }
  }
}

// ---- one record the server's realtime feed reported

/** A record created or changed (its whole record, as the feed sends it), or gone, on the server. */
export type Heard =
  | { topic: "notes"; note: Fetched } | { topic: "notes"; gone: Pick<Entry, "rec" | "path"> }
  | { topic: "tasks"; task: Versioned<Task> } | { topic: "tasks"; gone: string }
  | { topic: "links"; link: Link } | { topic: "links"; gone: string };

/** `h` taken into the copy as a pull of that one record would take it: a rev the row has already, or an older one, is ignored
 *  (this client's own write echoing back reaches it at the rev its push left, or while it is still unsent); a row edited here
 *  and not sent keeps its edit, for the push to settle; a record gone from the server goes here too unless edited here since.
 *  true when the copy changed. */
export function takeHeard(s: Store, h: Heard): boolean {
  if (h.topic === "notes") {
    if ("gone" in h) {
      const n = s.notes.get(h.gone.path);
      if (!n || n.rec !== h.gone.rec || !(n.deleted || (!unsent(n) && n.lost == null))) return false;
      s.notes.delete(n.path);
      return true;
    }
    const r = h.note, n = s.notes.get(r.path);
    if (!isNotePath(r.path) || (n && n.rec === r.rec && n.rev != null && n.rev >= r.rev)) return false;
    takeNote(s, r);
    return s.notes.get(r.path) !== n;
  }
  if (h.topic === "tasks") {
    if ("gone" in h) {
      const t = s.tasks.get(h.gone);
      if (!t || t.rev == null || !(t.deleted || !taskUnsent(t))) return false;
      s.tasks.delete(t.id);
      return true;
    }
    const t = s.tasks.get(h.task.id);
    if (t && t.rev != null && t.rev >= h.task.rev) return false;
    takeTask(s, h.task);
    return s.tasks.get(h.task.id) !== t;
  }
  if ("gone" in h) {
    const l = s.links.get(h.gone);
    if (l?.pushed == null) return false;                          // one made here and not up yet is the push's
    s.links.delete(h.gone);
    return true;
  }
  const l = s.links.get(h.link.id);
  if (l && l.pushed != null) return false;
  s.links.put(l ? { ...l, pushed: Date.now() } : { link: h.link, pushed: Date.now(), deleted: false });   // an add of ours that landed
  return true;
}

// ---- a round

/** A push alone: what was edited here goes up, in the order a full round sends it, and a server that can't be reached ends it.
 *  true when the server was reached. */
async function pushRound(c: Run): Promise<boolean> {
  let down = false;
  const r: Run = { ...c, fail: (what, e) => { if (unreachable(e)) down = true; c.fail(what, e); } };
  for (const step of [pushNotes, pushTasks, pushLinks, dropTasks]) {
    await step(r);
    if (down) break;
  }
  c.changed?.();
  return !down;
}

/** Pull then push (`pull`), or push alone, every record on its own: one failure holds back nothing else. Notes first, then
 *  tasks, then the links that name them. A server that can't be reached ends the round after the pull. true when the server
 *  was reached. */
export async function syncRound(c: Run, { pull }: { pull: boolean }): Promise<boolean> {
  if (!pull) return pushRound(c);
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

/** Rows with changes not sent and still to be tried: unsent or deleted notes, tasks and links, not those the server refused. */
export function waiting(s: Store): number {
  return s.notes.all().filter((n) => (unsent(n) || n.deleted) && n.refused == null).length
    + s.tasks.all().filter((t) => (taskUnsent(t) || t.deleted) && t.refused == null).length
    + s.links.all().filter((l) => (l.pushed == null || l.deleted) && l.refused == null).length;
}

/** A change the server refused: which row (`key`: a note's path, a task's or a link's id), what it was, and why. */
export type Refusal = { kind: "note" | "task" | "link"; key: string; title: string; deleted: boolean; reason: string };

/** Every change the server refused, waiting on the owner: send it again (`retryRefused`) or let it go (`discardRefused`). */
export function refusals(s: Store): Refusal[] {
  return [
    ...s.notes.all().flatMap((n) => n.refused == null ? [] : [{ kind: "note" as const, key: n.path, title: parseNote(n.path, n.text).title, deleted: n.deleted, reason: n.refused }]),
    ...s.tasks.all().flatMap((t) => t.refused == null ? [] : [{ kind: "task" as const, key: t.id, title: t.data.title, deleted: t.deleted, reason: t.refused }]),
    ...s.links.all().flatMap((l) => l.refused == null ? [] : [{ kind: "link" as const, key: l.link.id, title: "A link", deleted: l.deleted, reason: l.refused }]),
  ];
}

/** A refused change tried again on the next push, as it is. false when nothing was refused. */
export function retryRefused(s: Store, kind: Refusal["kind"], key: string): boolean {
  const clear = <R extends { refused?: string }>(t: Table<R>) => {
    const r = t.get(key);
    if (r?.refused == null) return false;
    t.put({ ...r, refused: undefined });
    return true;
  };
  return kind === "note" ? clear(s.notes) : kind === "task" ? clear(s.tasks) : clear(s.links);
}

/** A refused change let go: the row goes back to the server's version (a delete is undone), or away when the server never
 *  had it. false when nothing was refused. */
export function discardRefused(s: Store, kind: Refusal["kind"], key: string): boolean {
  if (kind === "note") {
    const n = s.notes.get(key);
    if (n?.refused == null) return false;
    if (n.rev == null || n.base == null) s.notes.delete(key);
    else { const t = tick(n); s.notes.put({ ...n, text: n.base, updated: t, pushed: t, deleted: false, refused: undefined, tainted: undefined }); }
  } else if (kind === "task") {
    const r = s.tasks.get(key);
    if (r?.refused == null) return false;
    if (r.rev == null || r.base == null) s.tasks.delete(key);
    else { const t = tick(r); s.tasks.put({ ...r, data: r.base, updated: t, pushed: t, deleted: false, refused: undefined }); }
  } else {
    const l = s.links.get(key);
    if (l?.refused == null) return false;
    if (l.pushed == null) s.links.delete(key);
    else s.links.put({ ...l, deleted: false, refused: undefined });
  }
  return true;
}

/** The paths of notes whose edits overlap the server's, waiting on a side being picked or on replaced text being restored. */
export const conflicted = (s: Store): string[] => s.notes.all().filter((n) => !n.deleted && (n.conflict_rev != null || n.lost != null)).map((n) => n.path);
