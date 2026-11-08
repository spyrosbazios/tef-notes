// The local copy this browser keeps of the notes, tasks and links (the rows of packages/core/src/sync.ts): everything the app
// shows is read from it, every edit is written to it first, and the sync engine reconciles it with the server. The phone keeps
// the same in SQLite (mobile/src/store/db.ts).
//
// Held whole in memory, as the phone holds its tasks and the web already held every note in the query cache: a personal
// notebook is small, and the engine reads and writes rows synchronously. IndexedDB is the copy that survives the page, written
// behind the memory (one atomic batch a moment after the last change, at once when the page is hidden) and read back on the next
// visit. It is keyval, not a database of indexes: nothing is ever looked up in it but "every row", and idb-keyval is already
// the app's IndexedDB layer (lib/offline.ts). A custom store is its own database (idb-keyval's custom-stores note: one store
// per database), so the rows share one store, their keys prefixed `n:` `t:` `l:`.
// https://github.com/jakearchibald/idb-keyval/blob/main/README.md, https://github.com/jakearchibald/idb-keyval/blob/HEAD/custom-stores.md
//
// Where IndexedDB is unavailable or full (a private window) the app runs on memory alone: edits still sync while the page is
// open, and unsent ones are lost with it. The same trade the query cache's persister makes (lib/persist.ts).
import { clear, createStore, delMany, entries, setMany } from "idb-keyval";
import type { LinkRow, NoteRow, Store, Table, TaskRow } from "@/core/sync";

const KEYS = { notes: "n:", tasks: "t:", links: "l:" } as const;

type Loadable<R> = Table<R> & { load: (key: string, row: R) => void; clear: () => void };

/** The three tables over memory, telling `write` of every change as `[storage key, row or null for a delete]`. */
export function tables(write: (key: string, row: unknown) => void) {
  const make = <R>(prefix: string, keyOf: (r: R) => string): Loadable<R> => {
    const rows = new Map<string, R>();
    return {
      get: (k) => rows.get(k),
      all: () => [...rows.values()],
      put: (r) => { const k = keyOf(r); rows.set(k, r); write(prefix + k, r); },
      delete: (k) => { if (rows.delete(k)) write(prefix + k, null); },
      load: (k, r) => { if (!rows.has(k)) rows.set(k, r); },       // a row written since the page opened is newer than the stored one
      clear: () => rows.clear(),
    };
  };
  const loaders = {
    notes: make<NoteRow>(KEYS.notes, (r) => r.path),
    tasks: make<TaskRow>(KEYS.tasks, (r) => r.id),
    links: make<LinkRow>(KEYS.links, (r) => r.link.id),
  };
  const store: Store = { notes: loaders.notes, tasks: loaders.tasks, links: loaders.links };
  return { store, loaders };
}

const hasIdb = typeof indexedDB !== "undefined";
const kv = createStore("tefnotes-sync", "rows");
const pending = new Map<string, unknown>();
let timer: ReturnType<typeof setTimeout> | undefined;
const WAIT = 100;

/** Everything changed so far into IndexedDB, as one batch of puts and one of deletes. A write that fails costs the copy, not the app. */
export async function flushLocal(): Promise<void> {
  clearTimeout(timer); timer = undefined;
  const batch = [...pending];
  pending.clear();
  if (!hasIdb || !batch.length) return;
  const puts = batch.filter(([, r]) => r !== null) as [string, unknown][], dels = batch.filter(([, r]) => r === null).map(([k]) => k);
  if (puts.length) await setMany(puts, kv).catch(() => {});
  if (dels.length) await delMany(dels, kv).catch(() => {});
}

const all = tables((key, row) => {
  pending.set(key, row);
  timer ??= setTimeout(() => { void flushLocal(); }, WAIT);
});

/** The copy: what the app reads and the engine syncs. */
export const local: Store = all.store;

/** Resolves once what an earlier visit stored is in `local`. Anything reading or syncing it waits for this. */
export const ready: Promise<void> = !hasIdb ? Promise.resolve() : entries(kv).then((rows) => {
  for (const [k, row] of rows as [string, unknown][]) {
    if (k.startsWith(KEYS.notes)) all.loaders.notes.load(k.slice(2), row as NoteRow);
    else if (k.startsWith(KEYS.tasks)) all.loaders.tasks.load(k.slice(2), row as TaskRow);
    else if (k.startsWith(KEYS.links)) all.loaders.links.load(k.slice(2), row as LinkRow);
  }
}).catch(() => {});

/** Forget the copy, here and in IndexedDB. What was never sent is gone with it: the caller checks. */
export async function clearLocal(): Promise<void> {
  clearTimeout(timer); timer = undefined;
  pending.clear();
  for (const t of Object.values(all.loaders)) t.clear();
  if (hasIdb) await clear(kv).catch(() => {});
}

// The page going away may not get to run a timer
if (typeof addEventListener === "function") {
  addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void flushLocal(); });
  addEventListener("pagehide", () => { void flushLocal(); });
}
