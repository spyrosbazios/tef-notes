// The local copy this browser keeps of the notes, tasks and links (the rows of packages/core/src/sync.ts): everything the app
// shows is read from it, every edit is written to it first, and the sync engine reconciles it with the server.
//
// Held whole in memory, as the web already held every note in the query cache: a personal
// notebook is small, and the engine reads and writes rows synchronously. IndexedDB is the copy that survives the page, written
// behind the memory (one transaction per batch, a moment after the last change, at once when the page is hidden; batches in
// order, one after another; a batch that fails stays pending for the next and says so in the sync status) and read back on
// the next visit. It is keyval, not a database of indexes: nothing is ever looked up in it but "every row", and idb-keyval is already
// the app's IndexedDB layer (lib/offline.ts). A custom store is its own database (idb-keyval's custom-stores note: one store
// per database), so the rows share one store, their keys prefixed `n:` `t:` `l:`.
// https://github.com/jakearchibald/idb-keyval/blob/main/README.md, https://github.com/jakearchibald/idb-keyval/blob/HEAD/custom-stores.md
//
// Where IndexedDB is unavailable or full (a private window) the app runs on memory alone: edits still sync while the page is
// open, and unsent ones are lost with it. The same trade the query cache's persister makes (lib/persist.ts).
import { clear, createStore, entries, promisifyRequest } from "idb-keyval";
import { recordId } from "@/core/pocketbase";
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

const hasIdb = typeof indexedDB !== "undefined";
const kv = createStore("tefnotes-sync", "rows");
let timer: ReturnType<typeof setTimeout> | undefined;
const WAIT = 100;

/** One batch, one transaction: its puts and deletes land together or not at all. */
const saved = persister((batch) => kv("readwrite", (store) => {
  for (const [k, r] of batch) {
    if (r === null) store.delete(k);
    else store.put(r, k);
  }
  return promisifyRequest(store.transaction);
}));

/** Why the last write to IndexedDB failed, until one goes through; what the sync status shows. */
export const storeError = { get: saved.error, watch: saved.watch };

/** Everything changed so far into IndexedDB, after any flush already out. */
export function flushLocal(): Promise<void> {
  clearTimeout(timer); timer = undefined;
  return hasIdb ? saved.flush() : Promise.resolve();
}

const all = tables((key, row) => {
  saved.note(key, row);
  timer ??= setTimeout(() => { void flushLocal(); }, WAIT);
});

/** The copy: what the app reads and the engine syncs. */
export const local: Store = all.store;

/** Resolves once what an earlier visit stored is in `local`. Anything reading or syncing it waits for this. */
export const ready: Promise<void> = !hasIdb ? Promise.resolve() : entries(kv).then((rows) => {
  for (const [k, row] of rows as [string, unknown][]) {
    // One-shot migration (2026-11-21), to delete once every browser has opened this version: a note made here before notes
    // carried a client record id was stored with `rec` null; it gets one now, written back so it keeps it
    if (k.startsWith(KEYS.notes) && (row as NoteRow).rec == null) {
      const given: NoteRow = { ...(row as NoteRow), rec: recordId() };
      all.loaders.notes.load(k.slice(2), given);
      if (local.notes.get(k.slice(2)) === given) local.notes.put(given);
    } else if (k.startsWith(KEYS.notes)) all.loaders.notes.load(k.slice(2), row as NoteRow);
    else if (k.startsWith(KEYS.tasks)) all.loaders.tasks.load(k.slice(2), row as TaskRow);
    else if (k.startsWith(KEYS.links)) all.loaders.links.load(k.slice(2), row as LinkRow);
  }
}).catch(() => {});

/** Forget the copy, here and in IndexedDB. What was never sent is gone with it: the caller checks. */
export async function clearLocal(): Promise<void> {
  clearTimeout(timer); timer = undefined;
  await saved.forget();
  for (const t of Object.values(all.loaders)) t.clear();
  if (hasIdb) await clear(kv);
}
