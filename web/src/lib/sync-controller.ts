// One sync controller per local store. All mutable status, timers and subscriptions belong to this
// instance; browser events and realtime are attached by the app, not by importing this module.
import { isNotePath } from "@/core/notes";
import {
  coalesced, conflicted, dismissLost, keepMine, restoreMine, syncRound, takeTheirs, waiting, type Store, type Transport,
} from "@/core/sync";

export type SyncStatus = { waiting: number; conflicts: string[]; syncing: boolean; error?: string };

export type Settle = "mine" | "theirs" | "restore" | "dismiss";

type Cancel = () => void;
type Later = (work: () => void, ms: number) => Cancel;
const later: Later = (work, ms) => { const timer = setTimeout(work, ms); return () => clearTimeout(timer); };

export function createSync({ store: local, ready, transport, online, schedule = later }: {
  store: Store; ready: Promise<void>; transport: Transport; online: () => boolean; schedule?: Later;
}) {
  let mounts = 0;
  // ---- what the app shows of it

  let status: SyncStatus = { waiting: 0, conflicts: [], syncing: false };
  const watchers = new Set<() => void>();

  /** The current status; the same object until something in it changes (what useSyncExternalStore needs). */
  const getStatus = (): SyncStatus => status;
  function watchStatus(l: () => void): () => void {
    watchers.add(l);
    return () => { watchers.delete(l); };
  }

  function refresh(over: Partial<Pick<SyncStatus, "syncing" | "error">> = {}) {
    const next: SyncStatus = { ...status, waiting: waiting(local), conflicts: conflicted(local), ...over };
    if (next.waiting === status.waiting && next.syncing === status.syncing && next.error === status.error && next.conflicts.join("\n") === status.conflicts.join("\n")) return;
    status = next;
    watchers.forEach((l) => l());
  }

  /** Called after a sync changed the copy: the app redraws from it (hooks/live.ts `useLive` registers the redraw). */
  const redraws = new Set<() => void>();
  function onRedraw(f: () => void): () => void {
    redraws.add(f);
    return () => { redraws.delete(f); };
  }
  const changed = () => { refresh(); redraws.forEach((f) => f()); };

  /** A new note's path moved aside by a sync (`-2`: another device had the name): where it is now. */
  const moved = new Map<string, string>();
  function movedTo(path: string): string {
    const to = moved.get(path);
    return to && !local.notes.get(path) ? to : path;
  }

  // ---- running

  /** How long after the last edit it goes up: a burst of edits is one push, and a note being typed into leaves "waiting" by itself. */
  const PUSH_AFTER = 1500;
  /** After a round that couldn't finish with edits waiting, how long before trying again (a back-online or a realtime
   *  reconnect asks sooner). */
  const RETRY_AFTER = 30_000;
  let pushTimer: Cancel | undefined, retryTimer: Cancel | undefined;

  const round = coalesced(async () => {
    await ready;
    retryTimer?.();
    if (!online()) { changed(); return; }                      // no network at all: everything stays waiting
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
      if (mounts && (!ok || errs.length) && waiting(local)) retryTimer = schedule(() => { void syncNow(); }, RETRY_AFTER);
    }
  });

  /** What the first read of the copy waits for: what an earlier visit stored, and, when there is none (a first visit, a cleared
   *  copy), one sync, so the lists don't open as an empty notebook that fills a moment later. Offline that sync ends at once. */
  async function opened(): Promise<void> {
    await ready;
    if (!local.notes.all().length && !local.tasks.all().length && !local.links.all().length) await syncNow();
  }

  /** Pull, then push. Safe to call from anywhere, any time: overlapping calls coalesce into one rerun. */
  function syncNow(): Promise<void> {
    pushTimer?.();                                           // this sync sends what the timer was waiting to
    return round();
  }

  /** Whether a sync is out (the engine keeps a delete as a tombstone then: its first upload of the record may yet land). */
  const syncing = () => round.running();

  /** An edit was made on the local copy: count it, and send it a moment after the last. */
  function edited(): void {
    refresh();
    pushTimer?.();
    if (mounts) pushTimer = schedule(() => { void syncNow(); }, PUSH_AFTER);
  }

  // ---- when

  let news: Cancel | undefined;

  /** A realtime record (PocketBase sends every column): news when the local copy lacks it or has another rev, not the echo of what
   *  this app just sent. A delete is news while the copy still holds it. */
  function heard(topic: "notes" | "tasks" | "links", action: string, r: { id: string; path?: unknown; rev?: unknown }): void {
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
    news?.();
    if (mounts) news = schedule(() => { void syncNow(); }, 250);
  }

  /** Start background work. Explicit syncNow calls also work before mounting (route loaders).
   *  Stopping prevents an in-flight round from scheduling another retry. */
  function start(): () => void {
    mounts++;
    if (mounts === 1) void syncNow();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      if (--mounts) return;
      pushTimer?.(); retryTimer?.(); news?.();
    };
  }

  // ---- a conflict settled

  /** false when there was nothing to settle (a second tap). The caller redraws. */
  function settle(path: string, how: Settle): boolean {
    const done = { mine: keepMine, theirs: takeTheirs, restore: restoreMine, dismiss: dismissLost }[how](local, path);
    if (!done) return false;
    refresh();
    if (how === "mine" || how === "restore") void syncNow();
    return true;
  }
  return { getStatus, watchStatus, onRedraw, movedTo, opened, syncNow, syncing, edited, heard, settle, start };
}
