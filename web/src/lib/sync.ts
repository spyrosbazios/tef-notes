// The web app's sync: the engine of packages/core/src/sync.ts run over the local copy (lib/local.ts) and this app's services, by
// the one tab that leads (lib/tab-sync.ts: the others mirror its copy and hand it their changes). Edits are made on the local
// copy first and shown from it; a sync sends them. One sync runs at a time: a request while one runs asks for one more after it.
// Pull and push (`syncNow`): the realtime feed's first connect and any reconnect after a gap, the browser coming back online,
// the owner's "Sync now", and screens that need the server's latest. Push alone (`pushNow`): 1.5 s after the last edit
// (`apply`, lib/records.ts: every write), the page coming to the front or going to the back, leaving a note. Between them what
// other devices change comes record by record from the realtime feed, rev-checked (core/sync.ts `takeHeard`).
//
// Writes this covers: notes, tasks and links. What it does not (attachment uploads, chats, clips, lenses, tags, push
// subscriptions) has no local copy to wait in and fails at once while offline: services/api.ts says which and how.
import type { Transport } from "@/core/sync";
import { createSync } from "./sync-controller";
export type { SyncStatus, Settle } from "./sync-controller";
import * as links from "@/services/links";
import * as notes from "@/services/notes";
import { watch } from "@/services/realtime";
import * as todo from "@/services/todo";
import { clearLocal, flushLocal, keep, local, onWrite, readLocal, storeError } from "./local";
import { getNet } from "./net";
import { createTabs, type Channel, type Lock, type Message } from "./tab-sync";

// ---- the server, as the engine asks of it

const at = (r: notes.Rec) => ({ rec: r.rec, path: r.path, rev: r.rev, kind: r.kind, text: r.text, at: Date.parse(r.updated) || undefined });

const transport: Transport = {
  notes: {
    list: notes.list,
    get: async (rec) => { const r = await notes.get(rec); return r && at(r); },
    create: notes.create,
    update: notes.update,
    remove: notes.remove,
  },
  tasks: { revs: todo.tasks.revs, get: todo.tasks.get, getMany: todo.tasks.getMany, create: todo.tasks.create, update: todo.tasks.update, remove: todo.tasks.remove },
  links: { ids: links.ids, byIds: links.byIds, add: links.add, remove: links.remove },
};

/** What a query over the local copy needs: it never touches the network, so it runs offline too (TanStack's default would pause
 *  it), and it changes only when the copy does (lib/local-records.ts), never by itself. */
export const LOCAL_QUERY = { networkMode: "always", staleTime: Infinity, retry: false } as const;

// ---- the tabs

/** The lock whose holder leads, and the channel the tabs talk over. */
const NAME = "tefnotes-sync";

const lock: Lock = ({ steal, signal }, granted) =>
  navigator.locks.request(NAME, steal ? { steal: true } : { signal }, () => { granted(); return new Promise<never>(() => {}); });

const broadcast = new BroadcastChannel(NAME);
const channel: Channel = {
  post: (m) => broadcast.postMessage(m),
  listen: (f) => {
    const on = (e: MessageEvent<Message>) => f(e.data);
    broadcast.addEventListener("message", on);
    return () => broadcast.removeEventListener("message", on);
  },
};

// The browser's one controller and its tab's part; tests can construct independent controllers over memory stores.
const controller = createSync({ store: local, transport, online: () => getNet().browser, stored: storeError });

export const sync = createTabs({
  tab: crypto.randomUUID(), store: local, controller, writes: onWrite,
  read: readLocal, keep, flush: flushLocal, clear: clearLocal,
  channel, lock, stream: watch,
  visible: () => typeof document === "undefined" || document.visibilityState === "visible",
  reload: () => location.reload(),
});
export const { getStatus, watchStatus, onRedraw, beforeRound, movedTo, opened, syncNow, pushNow, apply, settle, resolveRefused, live, clear } = sync;

/** Mounted by the app's live-data hook; importing storage or a feature installs no lifecycle listeners. */
export function startSync(): () => void {
  const stop = sync.start();
  const visible = () => {
    if (document.visibilityState === "hidden") void flushLocal();
    else sync.wake();
    void pushNow();
  };
  const online = () => { void syncNow(); };
  const leaving = () => { void flushLocal(); };
  document.addEventListener("visibilitychange", visible);
  addEventListener("online", online);
  addEventListener("pagehide", leaving);
  return () => {
    document.removeEventListener("visibilitychange", visible);
    removeEventListener("online", online);
    removeEventListener("pagehide", leaving);
    stop();
    void flushLocal();
  };
}
