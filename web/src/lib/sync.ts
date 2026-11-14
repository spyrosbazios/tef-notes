// The web app's sync: the engine of packages/core/src/sync.ts run over the local copy
// (lib/local.ts) and this app's services. Edits are made on the local copy first and shown from it; a sync sends them. One sync
// runs at a time: a request while one runs asks for one more after it. Triggers:
// the app opening, the page coming to the front or going to the back, the browser coming back online, 1.5 s after the last
// edit (`edited`), leaving a note (hooks/draft.ts) and any realtime event that is news (`heard`).
//
// Writes this covers: notes, tasks and links. What it does not (attachment uploads, chats, clips, lenses, tags, push
// subscriptions) has no local copy to wait in and fails at once while offline: services/api.ts says which and how.
import { AxiosError } from "axios";
import { Conflict } from "@/core/pocketbase";
import type { Transport } from "@/core/sync";
import { createSync } from "./sync-controller";
export type { SyncStatus, Settle } from "./sync-controller";
import * as links from "@/services/links";
import * as notes from "@/services/notes";
import * as todo from "@/services/todo";
import { flushLocal, local, ready } from "./local";
import { getNet } from "./net";

// ---- the server, as the engine asks of it

const at = (r: notes.Rec) => ({ rec: r.rec, path: r.path, rev: r.rev, kind: r.kind, text: r.text, at: Date.parse(r.updated) || undefined });

const transport: Transport = {
  notes: {
    list: notes.list,
    get: async (rec) => { const r = await notes.get(rec); return r && at(r); },
    read: async (path) => { const r = await notes.read(path); return r && at(r); },
    create: notes.create,
    update: notes.update,
    remove: notes.remove,
  },
  tasks: { revs: todo.tasks.revs, get: todo.tasks.get, getMany: todo.tasks.getMany, create: todo.tasks.create, update: todo.tasks.update, remove: todo.tasks.remove },
  links: { ids: links.ids, byIds: links.byIds, add: links.add, remove: links.remove },
  status: (e) => (e instanceof AxiosError ? e.response?.status : e instanceof Conflict ? 409 : undefined),
};

/** What a query over the local copy needs: it never touches the network, so it runs offline too (TanStack's default would pause
 *  it), and it changes only when the copy does (lib/local-records.ts), never by itself. */
export const LOCAL_QUERY = { networkMode: "always", staleTime: Infinity, retry: false } as const;

// The browser's one controller; tests can construct independent controllers over memory stores.
export const sync = createSync({ store: local, ready, transport, online: () => getNet().browser });
export const { getStatus, watchStatus, onRedraw, movedTo, opened, syncNow, syncing, edited, heard, settle } = sync;

/** Mounted by the app's live-data hook; importing storage or a feature installs no lifecycle listeners. */
export function startSync(): () => void {
  const stop = sync.start();
  const visible = () => {
    if (document.visibilityState === "hidden") void flushLocal();
    void syncNow();
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
