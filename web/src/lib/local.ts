// The local copy this browser keeps of the notes, tasks and links (the rows of packages/core/src/sync.ts): everything the app
// shows is read from it, every edit is written to it first, and the sync engine reconciles it with the server.
//
// Held whole in memory, as the web already held every note in the query cache: a personal
// notebook is small, and the engine reads and writes rows synchronously. IndexedDB is the copy that survives the page, written
// behind the memory (one transaction per batch, a moment after the last change, at once when the page is hidden; batches in
// order, one after another; a batch that fails stays pending for the next and says so in the sync status) and read back when a
// tab takes the lead. Only the tab that leads writes it (`keep`, lib/tab-sync.ts): every tab holds the copy in memory, the
// others as a mirror of the leader's. It is keyval, not a database of indexes: nothing is ever looked up in it but "every row",
// and idb-keyval is already the app's IndexedDB layer (lib/offline.ts). A custom store is its own database (idb-keyval's
// custom-stores note: one store per database), so the rows share one store, their keys prefixed `n:` `t:` `l:`, beside `v`,
// the shape they were written in (core/rows.ts `ROWS_VERSION`).
// https://github.com/jakearchibald/idb-keyval/blob/main/README.md, https://github.com/jakearchibald/idb-keyval/blob/HEAD/custom-stores.md
//
// Where IndexedDB is unavailable or full (a private window) the app runs on memory alone: edits still sync while the page is
// open, and unsent ones are lost with it. The same trade the query cache's persister makes (lib/persist.ts).
import { clear, createStore, entries, promisifyRequest } from "idb-keyval";
import type { Topic } from "@/core/changes";
import { recordId } from "@/core/client/pocketbase";
import { linkRowOf, noteRowOf, ROWS_VERSION, taskRowOf } from "@/core/rows";
import type { LinkRow, NoteRow, Store, Table, TaskRow } from "@/core/sync";
import type { Rows } from "./tab-sync";

const KEYS = { notes: "n:", tasks: "t:", links: "l:" } as const;
/** The key of the rows' shape. */
const VERSION = "v";

type Clearable<R> = Table<R> & { clear: () => void };

/** The three tables over memory, telling `write` of every change as `(table, key, row or null for a delete)`. */
export function tables(write: (topic: Topic, key: string, row: unknown) => void) {
  const make = <R>(topic: Topic, keyOf: (r: R) => string): Clearable<R> => {
    const rows = new Map<string, R>();
    return {
      get: (k) => rows.get(k),
      all: () => [...rows.values()],
      put: (r) => { const k = keyOf(r); rows.set(k, r); write(topic, k, r); },
      delete: (k) => { if (rows.delete(k)) write(topic, k, null); },
      clear: () => rows.clear(),
    };
  };
  const all = {
    notes: make<NoteRow>("notes", (r) => r.path),
    tasks: make<TaskRow>("tasks", (r) => r.id),
    links: make<LinkRow>("links", (r) => r.link.id),
  };
  const store: Store = { notes: all.notes, tasks: all.tasks, links: all.links };
  return { store, all };
}

/** The writes behind the memory: `note` a change (`row` null for a delete), `flush` what is pending as one batch through `save`.
 *  Flushes run one after another, so a later batch never lands before an earlier one. A batch is taken off `pending` only once
 *  saved, and only the rows not changed again since; one that fails stays, to go with the next flush, and `error` says why
 *  until a flush goes through (`watch` hears it change). */
export function persister(save: (batch: [string, unknown][]) => Promise<void>) {
  const pending = new Map<string, unknown>(), watchers = new Set<() => void>();
  let chain: Promise<void> = Promise.resolve(), error: string | undefined;
  const setError = (e: string | undefined) => { if (e !== error) { error = e; watchers.forEach((l) => l()); } };
  async function one(): Promise<void> {
    const batch = [...pending];
    if (!batch.length) return;
    try { await save(batch); } catch (e) {
      setError(`Changes couldn't be kept on this device: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    for (const [k, r] of batch) if (pending.get(k) === r) pending.delete(k);
    setError(undefined);
  }
  return {
    note: (key: string, row: unknown) => { pending.set(key, row); },
    flush: (): Promise<void> => (chain = chain.then(one)),
    /** Drop what is pending, once any flush out has ended. */
    forget: async (): Promise<void> => { await chain; pending.clear(); setError(undefined); },
    error: () => error,
    watch: (l: () => void) => { watchers.add(l); return () => { watchers.delete(l); }; },
  };
}

/** What a store holds when read: the rows by table, and the writes that bring it to this build's shape (`[key, value]`, null for
 *  a delete). `newer`: it was written in a shape newer than this build's, and is left alone. */
export type Stored = { rows: Rows; writes: [string, unknown][]; newer: boolean };

/** One-shot migration (2026-11-21), to delete once each of the owner's browsers has opened a build with it (its store then holds
 *  `v`; CHANGELOG, Unreleased): a store written before rows had a version. A note made here before notes carried a client record
 *  id was stored with `rec` null, and gets one now. Delete this and its call in `readStored`; a store without `v` is then read as
 *  version 1. */
function unversioned(key: string, row: unknown): unknown {
  if (!key.startsWith(KEYS.notes) || !row || typeof row !== "object" || (row as { rec?: unknown }).rec != null) return row;
  return { ...row, rec: recordId() };
}

/** The row `read` makes of `value`, added to `list` under `key`. */
function into<R>(list: [string, R | null][], read: (v: unknown) => R | undefined, key: string, value: unknown): R | undefined {
  const row = read(value);
  if (row) list.push([key, row]);
  return row;
}

/** `entries` (a store's every key and value) read as this build's rows: migrated from the shape they were written in, a row
 *  that isn't one dropped (core/rows.ts), each change to make on the store said in `writes`. */
export function readStored(entries: [string, unknown][]): Stored {
  const rows: Rows = { notes: [], tasks: [], links: [] }, writes: [string, unknown][] = [];
  const version = entries.find(([k]) => k === VERSION)?.[1];
  if (typeof version === "number" && version > ROWS_VERSION) return { rows, writes, newer: true };
  for (const [key, stored] of entries) {
    if (key === VERSION) continue;
    const value = version == null ? unversioned(key, stored) : stored, k = key.slice(2);
    const row = key.startsWith(KEYS.notes) ? into(rows.notes, noteRowOf, k, value)
      : key.startsWith(KEYS.tasks) ? into(rows.tasks, taskRowOf, k, value)
      : key.startsWith(KEYS.links) ? into(rows.links, linkRowOf, k, value) : undefined;
    if (!row) writes.push([key, null]);
    else if (value !== stored) writes.push([key, row]);
  }
  if (version !== ROWS_VERSION) writes.push([VERSION, ROWS_VERSION]);
  return { rows, writes, newer: false };
}

const hasIdb = typeof indexedDB !== "undefined";
const kv = createStore("tefnotes-sync", "rows");
let timer: ReturnType<typeof setTimeout> | undefined;
const WAIT = 100;

/** One batch, one transaction: its puts and deletes land together or not at all. */
const save = (batch: [string, unknown][]) => kv("readwrite", (store) => {
  for (const [k, r] of batch) {
    if (r === null) store.delete(k);
    else store.put(r, k);
  }
  return promisifyRequest(store.transaction);
});
const saved = persister(save);

/** Why this device's copy isn't kept: written by a newer build, which this one must not overwrite. */
let blocked: string | undefined;
const blockedWatchers = new Set<() => void>();

/** Why the last write to IndexedDB failed, until one goes through, or why the copy isn't kept at all; what the sync status shows. */
export const storeError = {
  get: () => blocked ?? saved.error(),
  watch: (l: () => void) => { blockedWatchers.add(l); const off = saved.watch(l); return () => { blockedWatchers.delete(l); off(); }; },
};

/** Everything changed so far into IndexedDB, after any flush already out. */
export function flushLocal(): Promise<void> {
  clearTimeout(timer); timer = undefined;
  return hasIdb ? saved.flush() : Promise.resolve();
}

const writers = new Set<(topic: Topic, key: string, row: unknown) => void>();
const all = tables((topic, key, row) => { for (const w of writers) w(topic, key, row); });

/** The copy: what the app reads and the engine syncs. */
export const local: Store = all.store;

/** Every write to the copy, as `(table, key, row or null)`, until the returned stop. */
export function onWrite(w: (topic: Topic, key: string, row: unknown) => void): () => void {
  writers.add(w);
  return () => { writers.delete(w); };
}

let keeping: (() => void) | undefined;

/** Whether the copy's changes are written to IndexedDB: on in the tab that leads, off in the others (lib/tab-sync.ts). Off drops
 *  what was pending: the tab that leads now holds the copy. */
export function keep(on: boolean): void {
  if (on && !keeping && hasIdb && !blocked) {
    keeping = onWrite((topic, key, row) => {
      saved.note(KEYS[topic] + key, row);
      timer ??= setTimeout(() => { void flushLocal(); }, WAIT);
    });
  } else if (!on && keeping) {
    keeping();
    keeping = undefined;
    clearTimeout(timer); timer = undefined;
    void saved.forget();
  }
}

/** The copy as IndexedDB holds it, in this build's shape (written back there first when it wasn't); empty without IndexedDB, or
 *  when a newer build wrote it (the copy is then not kept here, and the status says why). */
export async function readLocal(): Promise<Rows> {
  const none: Rows = { notes: [], tasks: [], links: [] };
  if (!hasIdb) return none;
  const read = readStored(await entries(kv));
  if (read.newer) {
    blocked = "This device's offline copy was written by a newer version of the app: reload to use it. Changes made here aren't kept on this device.";
    blockedWatchers.forEach((l) => l());
    return none;
  }
  if (read.writes.length) await save(read.writes);
  return read.rows;
}

/** Forget the copy, here and in IndexedDB. What was never sent is gone with it: the caller checks. */
export async function clearLocal(): Promise<void> {
  clearTimeout(timer); timer = undefined;
  await saved.forget();
  for (const t of Object.values(all.all)) t.clear();
  if (hasIdb) await clear(kv);
}
