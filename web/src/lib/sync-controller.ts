// One sync controller per local store. All mutable status, timers and subscriptions belong to this
// instance; browser events and realtime are attached by the app, not by importing this module.
import { applyChange, topicOf, type Change, type Topic } from "@/core/changes";
import { isNotePath } from "@/core/notes";
import {
  coalesced, conflicted, discardRefused, dismissLost, keepMine, refusals, restoreMine, retryRefused, syncRound, takeTheirs, waiting,
  type Refusal, type Store, type Transport,
} from "@/core/sync";

/** `refused`: changes the server refused, parked until the owner sends them again or lets them go (Settings lists them).
 *  `unsaved`: why the copy couldn't be written to this device's storage, until a write goes through (lib/local.ts). */
export type SyncStatus = { waiting: number; conflicts: string[]; refused: Refusal[]; syncing: boolean; error?: string; unsaved?: string };

export type Settle = "mine" | "theirs" | "restore" | "dismiss";

type Cancel = () => void;
type Later = (work: () => void, ms: number) => Cancel;
const later: Later = (work, ms) => { const timer = setTimeout(work, ms); return () => clearTimeout(timer); };

/** What the copy's storage says about its writes (lib/local.ts `storeError`); a copy kept in memory alone has none. */
type Stored = { get: () => string | undefined; watch: (l: () => void) => () => void };

export function createSync({ store: local, ready, transport, online, schedule = later, stored }: {
  store: Store; ready: Promise<void>; transport: Transport; online: () => boolean; schedule?: Later; stored?: Stored;
}) {
  let mounts = 0;
  // ---- what the app shows of it

  let status: SyncStatus = { waiting: 0, conflicts: [], refused: [], syncing: false };
  const watchers = new Set<() => void>();

  /** The current status; the same object until something in it changes (what useSyncExternalStore needs). */
  const getStatus = (): SyncStatus => status;
  function watchStatus(l: () => void): () => void {
    watchers.add(l);
    return () => { watchers.delete(l); };
  }

  const refusedKey = (r: Refusal[]) => r.map((x) => `${x.kind}:${x.key}:${x.title}:${x.reason}`).join("\n");
  function refresh(over: Partial<Pick<SyncStatus, "syncing" | "error">> = {}) {
    const next: SyncStatus = { ...status, waiting: waiting(local), conflicts: conflicted(local), refused: refusals(local), unsaved: stored?.get(), ...over };
    if (next.waiting === status.waiting && next.syncing === status.syncing && next.error === status.error && next.unsaved === status.unsaved
      && next.conflicts.join("\n") === status.conflicts.join("\n") && refusedKey(next.refused) === refusedKey(status.refused)) return;
    status = next;
    watchers.forEach((l) => l());
  }
  stored?.watch(() => refresh());

  /** Called after the copy changed, by a sync (every list: `topics` undefined), a write (`apply`) or a settled conflict or
   *  refusal (the lists it touched): the app redraws from it (hooks/live.ts `useLive` registers the redraw). */
  const redraws = new Set<(topics?: readonly Topic[]) => void>();
  function onRedraw(f: (topics?: readonly Topic[]) => void): () => void {
    redraws.add(f);
    return () => { redraws.delete(f); };
  }
  const redraw = (topics?: readonly Topic[]) => redraws.forEach((f) => f(topics));
  const changed = () => { refresh(); redraw(); };

  /** Work a round waits for before it pulls: an open note's typing not yet saved goes into the copy first (lib/records.ts), so
   *  the pull sees the note edited here and never drops it as deleted elsewhere. */
  const befores = new Set<() => Promise<void>>();
  function beforeRound(f: () => Promise<void>): () => void {
    befores.add(f);
    return () => { befores.delete(f); };
  }

  /** A new note's path moved aside by a sync (`-2`: another device had the name): where it is now. */
  const moved = new Map<string, string>();
  function movedTo(path: string): string {
    const to = moved.get(path);
    return to && !local.notes.get(path) ? to : path;
  }

  // ---- running

  /** How long after the last edit it goes up: a burst of edits is one push, and a note being typed into leaves "waiting" by itself. */
  const PUSH_AFTER = 1500;
  /** After a round that couldn't finish with edits waiting, how long before trying again: the first wait, doubled after each
   *  round that fails again up to the last, back to the first after a round that went through (a back-online or a realtime
   *  reconnect asks sooner). A change the server refused is not waiting: it is never retried by itself. */
  const RETRY_FIRST = 5_000, RETRY_MOST = 300_000;
  let pushTimer: Cancel | undefined, retryTimer: Cancel | undefined, failures = 0;

  const round = coalesced(async () => {
    await ready;
    await Promise.all([...befores].map((f) => f()));
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
      redraw();
      failures = ok && !errs.length ? 0 : failures + 1;
      if (mounts && failures && waiting(local)) retryTimer = schedule(() => { void syncNow(); }, Math.min(RETRY_FIRST * 2 ** (failures - 1), RETRY_MOST));
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

  /** The one way a write reaches the copy: `changes` applied in order (core/changes.ts), counted, sent a moment after the last
   *  (`PUSH_AFTER`), and the lists they touched redrawn. true when any changed something. Throws on one the copy refuses, those
   *  before it applied. Changes are data so that a copy held elsewhere (another tab's) can take them in place of this one. */
  function apply(changes: readonly Change[]): boolean {
    const touched = new Set<Topic>();
    try {
      for (const c of changes) if (applyChange(local, c, syncing())) touched.add(topicOf(c));
    } finally {
      if (touched.size) {
        refresh();
        pushTimer?.();
        if (mounts) pushTimer = schedule(() => { void syncNow(); }, PUSH_AFTER);
        redraw([...touched]);
      }
    }
    return touched.size > 0;
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
      isNews = gone ? !!n && !n.deleted && n.rec === r.id : !n || n.rec !== r.id || n.rev !== r.rev;
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

  /** false when there was nothing to settle (a second tap). */
  function settle(path: string, how: Settle): boolean {
    const done = { mine: keepMine, theirs: takeTheirs, restore: restoreMine, dismiss: dismissLost }[how](local, path);
    if (!done) return false;
    refresh();
    redraw(["notes"]);
    if (how === "mine" || how === "restore") void syncNow();
    return true;
  }
  /** A change the server refused, sent again as it is (`retry`) or let go (`discard`: back to the server's version, or away
   *  when the server never had it). false when it was not refused (a second tap). */
  function resolveRefused(r: Pick<Refusal, "kind" | "key">, how: "retry" | "discard"): boolean {
    const done = (how === "retry" ? retryRefused : discardRefused)(local, r.kind, r.key);
    if (!done) return false;
    refresh();
    redraw([r.kind === "note" ? "notes" : r.kind === "task" ? "tasks" : "links"]);
    if (how === "retry") void syncNow();
    return true;
  }
  return { getStatus, watchStatus, onRedraw, beforeRound, movedTo, opened, syncNow, syncing, apply, heard, settle, resolveRefused, start };
}

export type SyncController = ReturnType<typeof createSync>;
