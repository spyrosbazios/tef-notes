// The web app's sync: the engine of packages/core/src/sync.ts (the phone's sync contract, ported) run over the local copy
// (lib/local.ts) and this app's services. Edits are made on the local copy first and shown from it; a sync sends them. One sync
// runs at a time: a request while one runs asks for one more after it. Triggers, as the phone's (mobile/src/store/notes.ts):
// the app opening, the page coming to the front or going to the back, the browser coming back online, 1.5 s after the last
// edit (`edited`), leaving a note (hooks/draft.ts) and any realtime event that is news (`heard`).
//
// Writes this covers: notes, tasks and links. What it does not (attachment uploads, chats, clips, lenses, tags, push
// subscriptions) has no local copy to wait in and fails at once while offline: services/api.ts says which and how.
import { AxiosError } from "axios";
import { Conflict } from "@/core/pocketbase";
import { isNotePath } from "@/core/notes";
import {
  coalesced, conflicted, dismissLost, keepMine, restoreMine, syncRound, takeTheirs, waiting, type Transport,
} from "@/core/sync";
import * as links from "@/services/links";
import * as notes from "@/services/notes";
import * as todo from "@/services/todo";
import { local, ready } from "./local";
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
 *  it), and it changes only when the copy does (hooks `project*`), never by itself. */
export const LOCAL_QUERY = { networkMode: "always", staleTime: Infinity, retry: false } as const;

// ---- what the app shows of it

/** Changes waiting to be sent, notes in conflict, and whether a sync is out or the last one failed. */
export type SyncStatus = { waiting: number; conflicts: string[]; syncing: boolean; error?: string };

let status: SyncStatus = { waiting: 0, conflicts: [], syncing: false };
const watchers = new Set<() => void>();

/** The current status; the same object until something in it changes (what useSyncExternalStore needs). */
export const getStatus = (): SyncStatus => status;
export function watchStatus(l: () => void): () => void {
  watchers.add(l);
  return () => { watchers.delete(l); };
}

function refresh(over: Partial<Pick<SyncStatus, "syncing" | "error">> = {}) {
  const next: SyncStatus = { ...status, waiting: waiting(local), conflicts: conflicted(local), ...over };
  if (next.waiting === status.waiting && next.syncing === status.syncing && next.error === status.error && next.conflicts.join("\n") === status.conflicts.join("\n")) return;
  status = next;
  watchers.forEach((l) => l());
}

/** Called after a sync changed the copy: the app redraws from it (hooks/notes.ts `useLive` registers the redraw). */
const redraws = new Set<() => void>();
export function onRedraw(f: () => void): () => void {
  redraws.add(f);
  return () => { redraws.delete(f); };
}
const changed = () => { refresh(); redraws.forEach((f) => f()); };

/** A new note's path moved aside by a sync (`-2`: another device had the name): where it is now. */
const moved = new Map<string, string>();
export function movedTo(path: string): string {
  const to = moved.get(path);
  return to && !local.notes.get(path) ? to : path;
}

// ---- running

/** How long after the last edit it goes up: a burst of edits is one push, and a note being typed into leaves "waiting" by itself. */
const PUSH_AFTER = 1500;
/** After a round that couldn't finish with edits waiting, how long before trying again (a back-online or a realtime
 *  reconnect asks sooner). */
const RETRY_AFTER = 30_000;
let pushTimer: ReturnType<typeof setTimeout> | undefined, retryTimer: ReturnType<typeof setTimeout> | undefined;

const round = coalesced(async () => {
  await ready;
  clearTimeout(retryTimer);
  if (!getNet().browser) { changed(); return; }                      // no network at all: everything stays waiting
  const errs: string[] = [];
  refresh({ syncing: true });
  let ok = false;
  try {
    ok = await syncRound({
      store: local, api: transport, changed, moved: (from, to) => { moved.set(from, to); },
      fail: (what, e) => { errs.push(`${what}: ${e instanceof Error ? e.message : String(e)}`); },
    });
  } finally {
    refresh({ syncing: false, error: errs[0] });
    redraws.forEach((f) => f());
    if ((!ok || errs.length) && waiting(local)) retryTimer = setTimeout(() => { void syncNow(); }, RETRY_AFTER);
  }
});

/** What the first read of the copy waits for: what an earlier visit stored, and, when there is none (a first visit, a cleared
 *  copy), one sync, so the lists don't open as an empty notebook that fills a moment later. Offline that sync ends at once. */
export async function opened(): Promise<void> {
  await ready;
  if (!local.notes.all().length && !local.tasks.all().length && !local.links.all().length) await syncNow();
}

/** Pull, then push. Safe to call from anywhere, any time: overlapping calls coalesce into one rerun. */
export function syncNow(): Promise<void> {
  clearTimeout(pushTimer);                                           // this sync sends what the timer was waiting to
  return round();
}

/** Whether a sync is out (the engine keeps a delete as a tombstone then: its first upload of the record may yet land). */
export const syncing = () => round.running();

/** An edit was made on the local copy: count it, and send it a moment after the last. */
export function edited(): void {
  refresh();
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { void syncNow(); }, PUSH_AFTER);
}

// ---- when

let news: ReturnType<typeof setTimeout> | undefined;

/** A realtime record (PocketBase sends every column): news when the local copy lacks it or has another rev, not the echo of what
 *  this app just sent. A delete is news while the copy still holds it. */
export function heard(topic: "notes" | "tasks" | "links", action: string, r: { id: string; path?: unknown; rev?: unknown }): void {
  const gone = action === "delete";
  let isNews: boolean;
  if (topic === "notes") {
    if (typeof r.path !== "string" || !isNotePath(r.path)) return;
    const n = local.notes.get(r.path);
    isNews = gone ? !!n && !n.deleted : !n || n.rev !== r.rev;
  } else if (topic === "tasks") {
    const t = local.tasks.get(r.id);
    isNews = gone ? !!t && !t.deleted : !t || t.rev !== r.rev;
  } else {
    const l = local.links.get(r.id);
    isNews = gone ? !!l && !l.deleted : !l;
  }
  if (!isNews) return;
  clearTimeout(news);
  news = setTimeout(() => { void syncNow(); }, 250);
}

/** Mounted once: a sync now, and whenever the page comes to the front or goes to the back, or the browser is back online. */
export function startSync(): () => void {
  const visible = () => { void syncNow(); };
  const online = () => { void syncNow(); };
  void syncNow();
  document.addEventListener("visibilitychange", visible);
  addEventListener("online", online);
  return () => { document.removeEventListener("visibilitychange", visible); removeEventListener("online", online); clearTimeout(pushTimer); clearTimeout(retryTimer); clearTimeout(news); };
}

// ---- a conflict settled

/** A note whose edits overlap the server's: keep the local text (it goes up over the server's), or take the server's (the local
 *  text is kept to restore). Then, for the text that was kept to restore, put it back or let it go. */
export type Settle = "mine" | "theirs" | "restore" | "dismiss";

/** false when there was nothing to settle (a second tap). The caller redraws. */
export function settle(path: string, how: Settle): boolean {
  const done = { mine: keepMine, theirs: takeTheirs, restore: restoreMine, dismiss: dismissLost }[how](local, path);
  if (!done) return false;
  refresh();
  if (how === "mine" || how === "restore") void syncNow();
  return true;
}
