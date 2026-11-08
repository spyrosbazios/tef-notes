// What of the query cache is kept in the browser between visits (IndexedDB), so the installed app opens offline on what
// it last fetched. The provider is in root.tsx; this holds the decisions, as plain functions the tests reach.
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";
import type { QueryKey } from "@tanstack/react-query";

/** The query keys' first element worth keeping: the lists and details the app browses by. The notes, tasks and links are not
 *  here on purpose: they are read from the local copy (lib/local.ts), which is what keeps them, with the edits not yet sent.
 *  Everything else is left out on purpose, and so is anything added later until it is named here: the chats and models (the agent's), the reader's
 *  articles, and anything a person searched for (the palette's "find" is a route call, not a query at all). */
const KEPT = new Set(["tags", "lenses", "photos", "link-preview"]);

export const persistable = (key: QueryKey): boolean => typeof key[0] === "string" && KEPT.has(key[0]);

/** How long a stored cache is honoured, and (`gcTime`, which must not be shorter) how long a query lives unobserved. */
export const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

/** The build's own id (vite.config.ts `define`). A cache stored by another build is dropped, so a change to what a query
 *  holds needs no migration code; the cost is one refetch after each deploy, which an online visit does anyway. */
declare const __BUILD_ID__: string;
export const buster = (): string => __BUILD_ID__;

/** Where a persisted client is kept: idb-keyval's `get`/`set`/`del` (each takes the store last), or a stand-in. */
export type Keyed<S> = {
  get: (key: string, store?: S) => Promise<PersistedClient | undefined>;
  set: (key: string, v: PersistedClient, store?: S) => Promise<unknown>;
  del: (key: string, store?: S) => Promise<unknown>;
};

/** A persister that writes the latest client at most once per `wait` ms (the cache changes on every keystroke's save and
 *  every realtime event, and the notes list is the whole notebook), and at once when `flush` is called (the page is hiding).
 *  A write that fails (storage full, IndexedDB blocked in a private window) costs only the offline copy: the app goes on.
 *  `disable` ends the writing for good (a page about to reload with the copy cleared): what the cache does after it, and a
 *  flush as the page hides, is not stored. `removeClient` alone does not do that: the provider itself calls it to drop a cache
 *  that is too old or from another build, and the page goes on caching after. */
export function throttled<S>(kv: Keyed<S>, key: string, wait: number, store?: S): Persister & { flush: () => Promise<void>; disable: () => void } {
  let latest: PersistedClient | undefined, timer: ReturnType<typeof setTimeout> | undefined, off = false;
  const flush = async () => {
    clearTimeout(timer); timer = undefined;
    const c = latest; latest = undefined;
    if (c) await kv.set(key, c, store).catch(() => {});
  };
  return {
    persistClient: (c) => { if (off) return; latest = c; timer ??= setTimeout(() => { void flush(); }, wait); },
    restoreClient: () => kv.get(key, store),
    removeClient: async () => { clearTimeout(timer); timer = undefined; latest = undefined; await kv.del(key, store); },
    flush,
    disable: () => { off = true; clearTimeout(timer); timer = undefined; latest = undefined; },
  };
}
