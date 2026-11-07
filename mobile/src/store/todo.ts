// Tasks (core/todo.ts): the store the task screens read, and their sync. Records of their own on the server
// (`tasks`), held here as one SQLite row each (db.ts RecordRow) and wholly in memory, which a few thousand
// small records allow. They sync the way notes do (notes.ts), each record on its own: pull = one listing of every
// record's id and rev, then a fetch of only those that moved; push = an update per dirty row with the rev it was based
// on, a create (under the id the phone gave it) for a new one, a delete with its rev for a tombstone. A stale rev →
// field-level 3-way merge against the row's base (core/todo.ts mergeRecord): each side's changes kept, and where both
// changed one field, the phone's edit wins. One owner, so no conflict to pick a side in: the laptop's value of that
// one field is lost, the rest of its edit kept.
//
// Links between records (core/record-links.ts: a task about notes, what points at a note) ride the same sync, after the
// tasks they name: a set of ids, no rev, no merge. Pull = every link id, then a fetch of the ones the phone lacks; one it
// had in step with the server and the server no longer has is gone (deleted, or taken by a cascade). Push = an add per
// link made here (idempotent: the server's copy comes back, maybe under its own id), a remove per tombstone. A link whose
// task is gone here is dropped and never shown; the server's cascade takes its copy with the task.
import { useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { create } from "zustand";
import { HttpError } from "@/core/http";
import { inheritTags, withinLens, type Lens } from "@/core/lens";
import * as pb from "@/core/pocketbase";
import { linksForNextRound, newLink, sameLink, type Link, type LinkEnd, type LinkRole } from "@/core/record-links";
import { localDay } from "@/core/time";
import {
  complete, mergeRecord, newTask, nextOrder, normalizeTask, patchTask, reopen, taskOf, views, type Task, type TaskPatch, type Views,
} from "@/core/todo";
import * as db from "./db";
import { serverOf, useKeys } from "./keys";
import { activeLensNow, useActiveLens } from "./lenses";
import type { LiveEvent } from "./live";
import { failed, pool, tick, unreachable, type SyncState } from "./sync";

type S = {
  /** By id, done ones included; tombstones not. */
  tasks: Record<string, Task>;
  /** The links, oldest first; tombstones and those naming a task not here left out. */
  links: Link[];
  sync: SyncState;
  /** A new task; its id back. `order` left out puts it last. It carries the first tag of the lens that is on (core/lens.ts).
   *  Throws on a value the server would refuse, as every edit here does (core/todo.ts patchTask). */
  add: (fields: TaskPatch & { title: string }) => string;
  /** false when there is no such task. */
  update: (id: string, patch: TaskPatch) => boolean;
  /** Tick it: a repeating one's next round is a new task, whose id comes back. */
  complete: (id: string) => string | null;
  reopen: (id: string) => void;
  remove: (id: string) => void;
  /** A link made (core/record-links.ts newLink; throws on one it refuses); its id back, the one already there when the
   *  phone has this relation. */
  addLink: (from: LinkEnd, to: LinkEnd, role: LinkRole) => string;
  removeLink: (id: string) => void;
};

/** What the sync needs to know of one collection. */
type Spec<T extends { id: string }> = {
  coll: db.Coll;
  api: pb.RevCollection<T>;
  of: (r: unknown) => T;
  /** What goes up: the record mended where a merge left it inconsistent. */
  out: (t: T) => T;
};

const TASKS: Spec<Task> = { coll: "tasks", api: pb.tasks, of: taskOf, out: normalizeTask };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Whether a link's task ends (if any) are among `tasks`. */
const endsHere = (l: Link, tasks: Record<string, Task>) => [l.from, l.to].every((e) => e.type !== "task" || !!tasks[e.id]);

function index() {
  const tasks: Record<string, Task> = Object.fromEntries(db.allRecords<Task>("tasks").map((r) => [r.id, taskOf(r.data)]));
  return {
    tasks,
    links: db.linkRows().filter((r) => !r.deleted && endsHere(r.link, tasks)).map((r) => r.link),
  };
}

/** Every link not deleted here, its task there or not. */
const liveLinks = () => db.linkRows().filter((r) => !r.deleted).map((r) => r.link);

const refresh = () => useTodo.setState(index());

/** One record's fields written here: unsent until the next push. */
function save<T>(coll: db.Coll, id: string, data: T) {
  const r = db.getRecord<T>(coll, id);
  if (r && !r.deleted && same(r.data, data)) return;
  if (r) db.patchRecord<T>(coll, id, { data, updated: tick(r), deleted: false });
  else db.putRecord<T>({ coll, id, data, base: null, rev: null, updated: tick(), pushed: null, deleted: false });
}

/** A tombstone for the push, or gone at once when the server never had it — unless a sync is out, whose first upload
 *  of it may yet land. */
function unlink(coll: db.Coll, id: string) {
  const r = db.getRecord(coll, id);
  if (!r || r.deleted) return;
  if (r.rev != null || running) db.patchRecord(coll, id, { deleted: true });
  else db.deleteRecord(coll, id);
}

/** The writes of one action: saved, the store refreshed, a push soon. */
function edit(fn: () => void) {
  fn();
  refresh();
  pushSoon();
}

export const useTodo = create<S>()((set, get) => ({
  ...index(),
  sync: { state: serverOf() ? "syncing" : "off" },
  add: (fields) => {
    const t = newTask(pb.recordId(), { order: nextOrder(Object.values(get().tasks)), ...fields, tags: inheritTags(activeLensNow(), fields.tags) });
    edit(() => save("tasks", t.id, t));
    return t.id;
  },
  update: (id, patch) => {
    const t = get().tasks[id];
    if (!t) return false;
    const n = patchTask(t, patch);
    edit(() => save("tasks", id, n));
    return true;
  },
  complete: (id) => {
    const t = get().tasks[id];
    if (!t) return null;
    const r = complete(t, localDay(), pb.recordId), next = r.next;
    edit(() => {
      save("tasks", id, r.task);
      if (!next) return;
      save("tasks", next.id, next);
      for (const link of linksForNextRound(liveLinks(), id, next.id, pb.recordId)) db.putLink({ link, pushed: null, deleted: false });
    });
    return r.next?.id ?? null;
  },
  reopen: (id) => {
    const t = get().tasks[id];
    if (t?.done) edit(() => save("tasks", id, reopen(t)));
  },
  remove: (id) => edit(() => unlink("tasks", id)),
  addLink: (from, to, role) => {
    const want = newLink(pb.recordId(), from, to, role);
    const had = db.linkRows().find((r) => sameLink(r.link, want));
    if (had && !had.deleted) return had.link.id;
    edit(() => db.putLink(had ? { ...had, deleted: false } : { link: want, pushed: null, deleted: false }));
    return had ? had.link.id : want.id;
  },
  removeLink: (id) => edit(() => {
    const r = db.getLink(id);
    if (!r || r.deleted) return;
    if (r.pushed != null || running) db.putLink({ ...r, deleted: true });
    else db.deleteLink(id);
  }),
}));

/** Things' lists as of `today` over the tasks inside `lens` (every one when none). */
export const lensViews = (lens: Lens | null, tasks: Record<string, Task>, today: string): Views => views([...withinLens(lens, Object.values(tasks))], today);

/** Every task inside the lens that is on, done ones included: what a screen counts or lists. */
export function useTasks(): readonly Task[] {
  const tasks = useTodo((s) => s.tasks), lens = useActiveLens();
  return useMemo(() => withinLens(lens, Object.values(tasks)), [tasks, lens]);
}

/** Things' lists as of `today` (localDay()) inside the lens that is on, recomputed when a task or the lens changes. */
export function useTodoViews(today: string): Views {
  const tasks = useTodo((s) => s.tasks), lens = useActiveLens();
  return useMemo(() => lensViews(lens, tasks, today), [tasks, lens, today]);
}

/** Rebuild the store from SQLite. */
export const reloadTodo = refresh;

// ---- sync

type Fail = (what: string, e: unknown) => void;

/** The server's record into the row, unless edited or deleted here while the read was out (push sorts those out). */
function take<T extends { id: string }>(spec: Spec<T>, r: pb.Versioned<T>) {
  const { rev, ...fields } = r, data = spec.of(fields), n = db.getRecord<T>(spec.coll, data.id);
  if (n && (n.updated !== n.pushed || n.deleted)) return;
  const t = tick(n);
  db.putRecord<T>({ coll: spec.coll, id: data.id, data, base: data, rev, updated: t, pushed: t, deleted: false });
}

/** false when the server couldn't be reached. */
async function pull<T extends { id: string }>(s: pb.Server, spec: Spec<T>, fail: Fail): Promise<boolean> {
  let entries: pb.RevEntry[];
  try { entries = await spec.api.revs(s); } catch (e) { fail(spec.coll, e); return !unreachable(e); }
  const remote = new Map(entries.map((e) => [e.id, e.rev])), local = new Map(db.recordStates(spec.coll).map((r) => [r.id, r]));
  const stale = entries.filter((e) => { const l = local.get(e.id); return !l || (l.rev !== e.rev && !l.dirty && !l.deleted); }).map((e) => e.id);
  try { for (const r of await spec.api.getMany(s, stale)) take(spec, r); } catch (e) { fail(spec.coll, e); if (unreachable(e)) return false; }
  // Gone from the server: gone here too, unless edited here since (the push puts it back). A tombstone's delete is done.
  for (const l of local.values()) if (l.rev != null && !remote.has(l.id) && (l.deleted || !l.dirty)) db.deleteRecord(spec.coll, l.id);
  return true;
}

/** One record up. A stale rev: merged with the server's (the phone's edit winning a field both changed) and sent once
 *  more, unless the merge is the server's version already. */
async function send<T extends { id: string }>(s: pb.Server, spec: Spec<T>, id: string, retry = true): Promise<void> {
  const n = db.getRecord<T>(spec.coll, id);
  if (!n || n.deleted || n.updated === n.pushed) return;
  const at = n.updated, out = spec.out(spec.of(n.data));
  if (!same(out, n.data)) db.patchRecord<T>(spec.coll, id, { data: out });
  const done = async (r: pb.Versioned<T>) => {
    const now = db.getRecord<T>(spec.coll, id), { rev, ...fields } = r, base = spec.of(fields);
    if (!now) return spec.api.remove(s, id, rev);                  // dropped here while it went up
    db.patchRecord<T>(spec.coll, id, now.deleted ? { rev, base } : { rev, base, pushed: at });
  };
  const { id: _, ...fields } = out;
  try {
    const r = (n.rev != null ? await spec.api.update(s, id, n.rev, fields as Partial<Omit<T, "id">>) : null) ?? await spec.api.create(s, out);
    return await done(r);
  } catch (e) {
    if (!(e instanceof pb.Conflict)) throw e;
  }
  // Moved on since; or, for a create, this upload landed once before the app was killed (no base: every difference is the phone's)
  const rem = await spec.api.get(s, id);
  if (!rem) return done(await spec.api.create(s, out));
  const cur = db.getRecord<T>(spec.coll, id);
  if (!cur || cur.deleted) return;
  const { rev, ...rest } = rem, theirs = spec.of(rest);
  const merged = spec.out(mergeRecord(cur.base == null ? null : spec.of(cur.base), spec.of(cur.data), theirs).merged);
  const clean = same(merged, theirs);
  db.patchRecord<T>(spec.coll, id, { data: merged, base: theirs, rev, ...(clean ? { pushed: cur.updated } : {}) });
  if (!clean && retry) await send(s, spec, id, false);
}

/** One tombstone. Edited on the server since this phone last saw it: that edit outlives the delete, and it comes back. */
async function drop<T extends { id: string }>(s: pb.Server, spec: Spec<T>, t: db.RecordRow<T>): Promise<void> {
  const gone = () => { if (db.getRecord(spec.coll, t.id)?.deleted) db.deleteRecord(spec.coll, t.id); };
  if (t.rev == null) return gone();
  try {
    await spec.api.remove(s, t.id, t.rev);
    return gone();
  } catch (e) {
    if (!(e instanceof pb.Conflict)) throw e;
  }
  const rem = await spec.api.get(s, t.id);
  if (!rem) return gone();
  if (!db.getRecord(spec.coll, t.id)?.deleted) return;
  const { rev, ...fields } = rem, data = spec.of(fields), u = tick(t);
  db.putRecord<T>({ coll: spec.coll, id: t.id, data, base: data, rev, updated: u, pushed: u, deleted: false });
}

async function push<T extends { id: string }>(s: pb.Server, spec: Spec<T>, fail: Fail) {
  await pool(db.dirtyRecords<T>(spec.coll), 4, (r) => send(s, spec, r.id).catch((e) => fail(`${spec.coll}/${r.id}`, e)));
}

async function drops<T extends { id: string }>(s: pb.Server, spec: Spec<T>, fail: Fail) {
  await pool(db.recordTombstones<T>(spec.coll), 4, (t) => drop(s, spec, t).catch((e) => fail(`${spec.coll}/${t.id}`, e)));
}

// ---- links

/** How many ids one fetch names in its filter. */
const LINK_BATCH = 40;

/** "down" when the server couldn't be reached; "failed" when it answered badly (a server without links yet answers 404),
 *  so nothing is pushed this round: every add would be refused and dropped as if its end were gone. */
async function pullLinks(s: pb.Server, fail: Fail): Promise<"ok" | "failed" | "down"> {
  let ids: string[];
  try { ids = await pb.links.ids(s); } catch (e) { fail("links", e); return unreachable(e) ? "down" : "failed"; }
  const remote = new Set(ids), rows = new Map(db.linkRows().map((r) => [r.link.id, r]));
  const missing = ids.filter((id) => !rows.has(id));
  try {
    for (let i = 0; i < missing.length; i += LINK_BATCH) {
      const filter = missing.slice(i, i + LINK_BATCH).map((id) => `id = ${pb.lit(id)}`).join(" || ");
      for (const link of await pb.links.list(s, filter)) if (!db.getLink(link.id)) db.putLink({ link, pushed: Date.now(), deleted: false });
    }
  } catch (e) { fail("links", e); return unreachable(e) ? "down" : "failed"; }
  for (const r of rows.values()) {
    if (remote.has(r.link.id)) { if (r.pushed == null) db.putLink({ ...r, pushed: Date.now() }); }   // an add that landed before the app was killed
    else if (r.pushed != null) db.deleteLink(r.link.id);          // gone from the server; a tombstone's delete is done
  }
  return "ok";
}

/** A task end's record: "here" on the server, "pending" made here and not up yet, "gone" not on the phone. */
function taskEnd(id: string): "here" | "pending" | "gone" {
  const r = db.getRecord("tasks", id);
  return !r || r.deleted ? "gone" : r.rev == null ? "pending" : "here";
}

async function pushLinks(s: pb.Server, fail: Fail) {
  for (const r of db.linkRows()) {
    const l = r.link, id = l.id;
    try {
      if (r.deleted) {
        await pb.links.remove(s, id);
        if (db.getLink(id)?.deleted) db.deleteLink(id);
        continue;
      }
      if (r.pushed != null) continue;
      const ends = [l.from, l.to].filter((e) => e.type === "task").map((e) => taskEnd(e.id));
      if (ends.includes("gone")) { db.deleteLink(id); continue; }  // its task deleted here: the server's cascade sees to its copy
      if (ends.includes("pending")) continue;                       // its task didn't go up this round: next time
      const got = await pb.links.add(s, l), now = db.getLink(id);
      if (!now) { await pb.links.remove(s, got.id); continue; }
      if (got.id !== id) db.deleteLink(id);                          // the server had this relation under its own id
      db.putLink({ link: got, pushed: Date.now(), deleted: now.deleted });
    } catch (e) {
      if (e instanceof HttpError && e.status === 404 && !r.deleted) db.deleteLink(id);   // an end is gone from the server
      else fail(`links/${id}`, e);
    }
  }
}

let running: Promise<void> | null = null, again = false, lastSync = 0;

/** After the last edit, how long before it goes up: a burst of edits (a tick, then its undo) is one push. */
const PUSH_AFTER = 1500;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
const pushSoon = () => { clearTimeout(pushTimer); pushTimer = setTimeout(() => void syncTodo(), PUSH_AFTER); };

/** Pull then push. Safe to call any time: overlapping calls coalesce into one rerun. A server
 *  that can't be reached ends the round after the pull. */
export function syncTodo(): Promise<void> {
  clearTimeout(pushTimer);
  if (running) { again = true; return running; }
  const server = serverOf();
  if (!server) { useTodo.setState({ sync: { state: "off" } }); return Promise.resolve(); }
  running = (async () => {
    useTodo.setState({ sync: { ...useTodo.getState().sync, state: "syncing" } });
    const errs: string[] = [], fail: Fail = (what, e) => { errs.push(`${what}: ${e instanceof Error ? e.message : String(e)}`); };
    try {
      const links = await pull(server, TASKS, fail) ? await pullLinks(server, fail) : "down";
      if (links !== "down") {
        refresh();
        await push(server, TASKS, fail);
        if (links === "ok") await pushLinks(server, fail);
        await drops(server, TASKS, fail);
        lastSync = Date.now();
      }
    } catch (e) {
      fail("sync", e);
    } finally {
      refresh();
      useTodo.setState({ sync: errs.length ? failed(errs) : { state: "idle", at: Date.now() } });
      running = null;
      if (again) { again = false; void syncTodo(); }
    }
  })();
  return running;
}

/** The server's news, or this phone's push echoing back: a record whose rev the phone has is the echo; a link the phone has
 *  (or, deleted, hasn't) too. */
function isNews(e: LiveEvent): boolean {
  const r = e.record;
  if (!r || typeof r.id !== "string") return true;
  if (e.topic === "links") { const l = db.getLink(r.id); return e.action === "delete" ? !!l && !l.deleted : !l; }
  const n = db.getRecord(e.topic as db.Coll, r.id);
  if (e.action === "delete") return !!n && !n.deleted;
  return !n || n.rev !== r.rev;
}

/** A sync that ended this recently already knows what a fresh connection would tell it. */
const RECENT = 5000;

/** The feed's events (live.ts) → at most one sync. */
export function heardTodo(events: LiveEvent[]) {
  const news = events.some((e) => (e.topic === "tasks" || e.topic === "links") && isNews(e));
  const connect = events.some((e) => e.topic === "connect") && !running && Date.now() - lastSync > RECENT;
  if (news || connect) void syncTodo();
}

/** Mounted once, in the root layout: a sync on launch, on coming to the front and going to the back, and when the
 *  server's address changes. */
export function useTodoSync() {
  useEffect(() => {
    void syncTodo();
    const app = AppState.addEventListener("change", (s) => { if (s === "active" || s === "background") void syncTodo(); });
    const keys = useKeys.subscribe((k, was) => { if (k.keys.server !== was.keys.server) void syncTodo(); });
    return () => { app.remove(); keys(); };
  }, []);
}
