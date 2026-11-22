// One tab writes the copy; the others mirror it. Every tab of the app holds the notes, tasks and links in memory (lib/local.ts),
// but only one, the leader, runs the sync engine (lib/sync-controller.ts), the realtime stream and the writes to IndexedDB: two
// tabs each writing their own copy there overwrote each other's unsent edits.
//   - Who leads: the tab holding the Web Lock (`Lock`), held for the tab's life, so the next tab in the lock's queue takes over
//     when it closes, and loads the copy from IndexedDB. Each tab names itself (`tab`) on the channel.
//   - A follower applies a write to its own copy at once (the page shows it and reads it back as the leader would: the change is
//     data, core/changes.ts) and asks the leader to apply it. The leader applies it, keeps it in IndexedDB, then answers and says
//     what it holds for the rows the change named, which the follower takes over its guess. Until that answer the change stays in
//     the follower's outbox: a new leader is asked again (or, when this tab is the one taking over, applies it itself), so a
//     leader closing mid-write loses nothing a follower sent.
//   - After every change to its copy (a write, a round, a realtime record) the leader sends the rows that changed, the moves
//     aside and the status; a tab that joins asks for the whole copy. What its realtime stream hears besides records (pictures,
//     chats, the preferences, a gap) it passes on (`Relayed`), so the followers' screens hear it too.
//   - The leader's rounds wait for its own open notes' typing (lib/records.ts `beforeRound`), not a follower's: typing whose note
//     a pull dropped meanwhile puts it back when it is written (core/changes.ts `note.write` names the note by record id).
//   - A follower in front whose leader doesn't answer a ping within `STEAL_AFTER` steals the lock: a background tab the phone has
//     frozen keeps the lock and answers nothing (Chrome for Android freezes pages whatever they hold:
//     https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/browser/performance_manager/docs/freezing_opt_out_opt_in.md).
//     A leader whose lock was stolen finds out when it runs again, stops its engine and stream, stops writing IndexedDB, and
//     follows.
// One design, no fallback: Web Locks and BroadcastChannel are in every browser the PWA targets (https://caniuse.com/web-locks,
// https://caniuse.com/broadcastchannel). The browser parts are injected (`Deps`): lib/sync.ts hands it navigator.locks, a
// BroadcastChannel and the IndexedDB copy; web/test/tab-sync.test.ts fakes.
import { applyChange, keysOf, topicOf, type Change, type Topic } from "@/core/changes";
import {
  discardRefused, dismissLost, keepMine, restoreMine, retryRefused, takeTheirs,
  type Heard, type LinkRow, type NoteRow, type Refusal, type Store, type Table, type TaskRow,
} from "@/core/sync";
import type { Settle, SyncController, SyncStatus } from "./sync-controller";

// ---- the copy as messages carry it

/** Rows by table, `[key, row]`, null for a row gone. */
export type Rows = { notes: [string, NoteRow | null][]; tasks: [string, TaskRow | null][]; links: [string, LinkRow | null][] };

/** Every row of `s`. */
export const rowsOf = (s: Store): Rows => ({
  notes: s.notes.all().map((r) => [r.path, r]), tasks: s.tasks.all().map((r) => [r.id, r]), links: s.links.all().map((r) => [r.link.id, r]),
});

function into<R>(t: Table<R>, list: [string, R | null][], whole: boolean, keyOf: (r: R) => string): boolean {
  let changed = false;
  if (whole) {
    const kept = new Set(list.map(([k]) => k));
    for (const r of t.all()) if (!kept.has(keyOf(r))) { t.delete(keyOf(r)); changed = true; }
  }
  for (const [k, r] of list) {
    if (r) { t.put(r); changed = true; }
    else if (t.get(k) !== undefined) { t.delete(k); changed = true; }
  }
  return changed;
}

/** `rows` into `s`; `whole`: they are all of it, and every other row goes. The tables that changed. */
export function mirror(s: Store, rows: Rows, whole = false): Topic[] {
  const out: Topic[] = [];
  if (into(s.notes, rows.notes, whole, (r) => r.path)) out.push("notes");
  if (into(s.tasks, rows.tasks, whole, (r) => r.id)) out.push("tasks");
  if (into(s.links, rows.links, whole, (r) => r.link.id)) out.push("links");
  return out;
}

/** The rows changed since the last `take`, by table and key, the last write of each winning. */
export function changedRows() {
  const pending: Record<Topic, Map<string, unknown>> = { notes: new Map(), tasks: new Map(), links: new Map() };
  return {
    note: (t: Topic, key: string, row: unknown) => { pending[t].set(key, row); },
    take(): Rows | null {
      if (!pending.notes.size && !pending.tasks.size && !pending.links.size) return null;
      const rows = { notes: [...pending.notes], tasks: [...pending.tasks], links: [...pending.links] } as Rows;
      for (const m of Object.values(pending)) m.clear();
      return rows;
    },
  };
}

// ---- the messages

/** What a follower asks the leader to do. */
export type Ask =
  | { op: "apply"; changes: Change[] }
  | { op: "sync" } | { op: "push" } | { op: "opened" } | { op: "clear" }
  | { op: "settle"; path: string; how: Settle }
  | { op: "resolve"; kind: Refusal["kind"]; key: string; how: "retry" | "discard" };

/** What the leader's realtime stream hears besides records, passed on to every tab's screens (hooks/live.ts). `gap`: the stream
 *  came back after missing events, and what isn't a record (chats, the preferences) is read again. */
export type Relayed =
  | { topic: "attachments" } | { topic: "chats" } | { topic: "gap" }
  | { topic: "prefs"; record: { id: string; key?: unknown; data?: unknown } };

/** Every message names the tab that sent it (`tab`); `to` names the one it is for. */
export type Message =
  | { t: "hello"; tab: string }                                        // a follower asks for the whole copy
  | { t: "leader"; tab: string }                                       // a tab took the lead: ask it again
  | { t: "ping"; tab: string } | { t: "pong"; tab: string }
  | { t: "copy"; tab: string; to: string; rows: Rows; moved: [string, string][]; status: SyncStatus }
  | { t: "rows"; tab: string; rows: Rows; moved: [string, string][] }
  | { t: "status"; tab: string; status: SyncStatus }
  | { t: "ask"; tab: string; id: number; ask: Ask }
  | { t: "answer"; tab: string; to: string; id: number; value: boolean; error?: string }
  | { t: "relay"; tab: string; event: Relayed }
  | { t: "cleared"; tab: string };                                     // the copy was forgotten: every tab reloads

// ---- what it runs over

export type Channel = { post: (m: Message) => void; listen: (f: (m: Message) => void) => () => void };
/** Ask for the lead: `granted` once the lock is held (for the tab's life). Rejects when another tab steals it, or when `signal`
 *  drops a request not yet granted. */
export type Lock = (o: { steal: boolean; signal?: AbortSignal }, granted: () => void) => Promise<void>;
/** What the realtime stream reports (services/realtime.ts `watch`). */
export type StreamHandlers = { heard: (h: Heard) => void; gap: () => void; feed: (problem?: string) => void; relay: (e: Relayed) => void };

type Later = (work: () => void, ms: number) => () => void;
const later: Later = (work, ms) => { const timer = setTimeout(work, ms); return () => clearTimeout(timer); };

export type Deps = {
  /** This tab's name on the channel. */
  tab: string;
  /** The copy in memory: the leader's own, a follower's mirror. */
  store: Store;
  /** The engine over `store`, run while this tab leads. */
  controller: SyncController;
  /** Every write to `store`, `(table, key, row or null)`. */
  writes: (w: (t: Topic, key: string, row: unknown) => void) => () => void;
  /** The copy kept in IndexedDB; `keep` writes `store`'s changes there (on while leading), `flush` what is pending, `clear`
   *  forgets it there and in memory. */
  read: () => Promise<Rows>;
  keep: (on: boolean) => void;
  flush: () => Promise<void>;
  clear: () => Promise<void>;
  channel: Channel;
  lock: Lock;
  stream: (h: StreamHandlers) => () => void;
  /** Whether this tab is in front. */
  visible: () => boolean;
  reload: () => void;
  schedule?: Later;
};

/** How long a follower in front waits for its leader to answer a ping before taking the lead. */
export const STEAL_AFTER = 5000;

export function createTabs(d: Deps) {
  const { tab, store, controller: c, channel } = d;
  const schedule = d.schedule ?? later;
  let role: "leader" | "follower" = "follower";
  /** The tab that leads, as last heard from (this one while it leads). */
  let leader: string | null = null;

  // ---- what the screens read: the status, the redraws, the moves aside

  let status: SyncStatus = c.getStatus();
  const watchers = new Set<() => void>(), redraws = new Set<(topics?: readonly Topic[]) => void>();
  const setStatus = (s: SyncStatus) => { if (s !== status) { status = s; watchers.forEach((l) => l()); } };
  const redraw = (topics?: readonly Topic[]) => redraws.forEach((f) => f(topics));
  let moved = new Map<string, string>();

  /** Resolves once this tab holds a copy: the leader's from IndexedDB, a follower's from the leader. */
  let have!: () => void;
  const copied = new Promise<void>((r) => { have = r; });

  c.watchStatus(() => {
    if (role !== "leader") return;
    setStatus(c.getStatus());
    channel.post({ t: "status", tab, status });
  });
  c.onRedraw((topics) => { if (role === "leader") redraw(topics); });

  // ---- the leader: the rows that changed, sent once the work in hand is done

  const out = changedRows();
  let sending = false;
  function sendRows() {
    sending = false;
    const rows = out.take();
    if (rows && role === "leader") channel.post({ t: "rows", tab, rows, moved: c.moves() });
  }
  d.writes((t, key, row) => {
    if (role !== "leader") return;
    out.note(t, key, row);
    if (!sending) { sending = true; queueMicrotask(sendRows); }
  });

  /** One change of a follower's, which it applied to its copy: applied here on its own, as each was decided there. One this copy
   *  can't take (a path taken meanwhile) is passed over; the rows it names, sent back, put the follower right. */
  function applyTheirs(ch: Change): boolean {
    try { return c.apply([ch]); } catch { return false; }
  }

  async function run(a: Ask): Promise<boolean> {
    switch (a.op) {
      case "apply": {
        let any = false;
        for (const ch of a.changes) {
          any = applyTheirs(ch) || any;
          const [t, key] = keysOf(ch);
          out.note(t, key, store[t].get(key) ?? null);
        }
        await d.flush();                                       // kept before the answer: the follower's outbox lets it go
        return any;
      }
      case "sync": await c.syncNow(); return true;
      case "push": await c.pushNow(); return true;
      case "opened": await c.opened(); return true;
      case "clear": await clearCopy(); return true;
      case "settle": return c.settle(a.path, a.how);
      case "resolve": return c.resolveRefused(a, a.how);
    }
  }

  async function serve(from: string, id: number, a: Ask) {
    let value = false, error: string | undefined;
    try { value = await run(a); } catch (e) { error = e instanceof Error ? e.message : String(e); }
    sendRows();
    channel.post({ t: "answer", tab, to: from, id, value, error });
    if (a.op === "clear" && error == null) d.reload();       // every other tab reloads on `cleared`; this one too
  }

  async function clearCopy() {
    await d.clear();
    channel.post({ t: "cleared", tab });
  }

  // ---- the realtime stream, the leader's

  let live: ((e: Relayed) => void) | undefined, stopStream: (() => void) | undefined;
  const relay = (e: Relayed) => { live?.(e); channel.post({ t: "relay", tab, event: e }); };
  const handlers: StreamHandlers = {
    heard: (h) => c.heard(h),
    gap: () => { void c.syncNow(); relay({ topic: "gap" }); },
    feed: (problem) => c.feed(problem),
    relay,
  };
  const startStream = () => { if (role === "leader" && live && !stopStream) stopStream = d.stream(handlers); };

  // ---- a follower's outbox

  type Out = { ask: Ask; done: (v: boolean) => void; fail: (e: Error) => void };
  const asks = new Map<number, Out>();
  let nextAsk = 0;
  function ask(a: Ask): Promise<boolean> {
    const id = ++nextAsk;
    const p = new Promise<boolean>((done, fail) => { asks.set(id, { ask: a, done, fail }); });
    channel.post({ t: "ask", tab, id, ask: a });
    probe();
    return p;
  }

  /** The changes still waiting for the leader's answer, applied again over a whole copy (which may predate them). */
  function reapply() {
    for (const o of asks.values()) {
      if (o.ask.op !== "apply") continue;
      for (const ch of o.ask.changes) { try { applyChange(store, ch, status.syncing); } catch { continue; } }
    }
  }

  // ---- is the leader there

  let alive = 0, probing = false, overdue = false;
  /** Ping the leader; no answer within STEAL_AFTER while this tab is in front, and this tab takes the lead. */
  function probe() {
    if (role === "leader" || probing || taking) return;
    probing = true;
    const seen = alive;
    channel.post({ t: "ping", tab });
    schedule(() => {
      probing = false;
      if (role === "leader" || taking || alive !== seen) return;
      if (d.visible()) steal();
      else overdue = true;                                     // pinged again once this tab comes to the front (`wake`)
    }, STEAL_AFTER);
  }

  // ---- taking the lead and giving it up

  let queued: AbortController | undefined, taking = false, mounts = 0, stopEngine: (() => void) | undefined;

  function queue() {
    const ac = new AbortController();
    queued = ac;
    d.lock({ steal: false, signal: ac.signal }, () => { queued = undefined; void lead(); }).catch(() => { if (!ac.signal.aborted) follow(); });
  }

  function steal() {
    queued?.abort();
    queued = undefined;
    d.lock({ steal: true }, () => { void lead(); }).catch(() => follow());
  }

  async function lead() {
    taking = true;
    let rows: Rows;
    try { rows = await d.read(); } catch { rows = { notes: [], tasks: [], links: [] }; }
    taking = false;
    mirror(store, rows, true);
    role = "leader";
    leader = tab;
    moved = new Map();
    d.keep(true);
    channel.post({ t: "leader", tab });
    c.loaded();
    setStatus(c.getStatus());
    channel.post({ t: "status", tab, status });
    have();
    // What this tab asked of the leader before it and never heard back about: done here, in order
    const mine = [...asks.values()];
    asks.clear();
    for (const o of mine) {
      if (o.ask.op === "apply") { for (const ch of o.ask.changes) applyTheirs(ch); o.done(true); continue; }
      try { o.done(await run(o.ask)); } catch (e) { o.fail(e instanceof Error ? e : new Error(String(e))); }
    }
    if (mounts) stopEngine = c.start();
    startStream();
  }

  /** Follow: from the start, or after the lock was stolen while leading. */
  function follow() {
    if (role === "leader") {
      role = "follower";
      leader = null;
      stopEngine?.(); stopEngine = undefined;
      stopStream?.(); stopStream = undefined;
      d.keep(false);
    }
    queue();
    channel.post({ t: "hello", tab });
    probe();
  }

  // ---- the channel

  channel.listen((m) => {
    if (m.t === "ping") { if (role === "leader") channel.post({ t: "pong", tab }); return; }
    if (m.t === "pong") { if (role === "follower") alive++; return; }   // only a tab that leads answers
    if (role === "leader") {
      if (m.t === "hello") channel.post({ t: "copy", tab, to: m.tab, rows: rowsOf(store), moved: c.moves(), status });
      else if (m.t === "ask") void serve(m.tab, m.id, m.ask);
      return;
    }
    if (m.t === "hello" || m.t === "ask") return;                // for the leader
    if (m.t === "cleared") { d.reload(); return; }
    if (m.t === "answer") {
      if (m.to !== tab) return;
      const o = asks.get(m.id);
      if (!o) return;
      asks.delete(m.id);
      if (m.error != null) o.fail(new Error(m.error)); else o.done(m.value);
      return;
    }
    if (m.t === "leader") {
      leader = m.tab;
      alive++;
      channel.post({ t: "hello", tab });
      for (const [id, o] of asks) channel.post({ t: "ask", tab, id, ask: o.ask });
      return;
    }
    if (m.t === "copy") {
      if (m.to !== tab) return;
      leader = m.tab;
    }
    if (m.tab !== leader) return;                                // a tab that no longer leads
    alive++;
    if (m.t === "copy") {
      mirror(store, m.rows, true);
      reapply();
      moved = new Map(m.moved);
      setStatus(m.status);
      redraw();
      have();
    } else if (m.t === "rows") {
      const touched = mirror(store, m.rows);
      moved = new Map(m.moved);
      if (touched.length) redraw(touched);
    } else if (m.t === "status") setStatus(m.status);
    else if (m.t === "relay") live?.(m.event);
  });

  follow();

  // ---- what the app calls, whichever tab leads

  const leading = () => role === "leader";

  /** The one way a write reaches the copy (lib/sync-controller.ts `apply`): here, or, in a follower, on its copy at once and
   *  then on the leader's. Throws on one the copy refuses, those before it applied (and sent). */
  function apply(changes: readonly Change[]): boolean {
    if (leading()) return c.apply(changes);
    const touched = new Set<Topic>();
    let done = 0;
    try {
      for (const ch of changes) {
        if (applyChange(store, ch, status.syncing)) touched.add(topicOf(ch));
        done++;
      }
    } finally {
      if (done) ask({ op: "apply", changes: changes.slice(0, done) }).catch(() => undefined);
      if (touched.size) redraw([...touched]);
    }
    return touched.size > 0;
  }

  /** A follower's answer for a call that waits on the leader: the leader's work, done. */
  const waitFor = (a: Ask) => ask(a).then(() => undefined, () => undefined);

  async function syncNow(): Promise<void> { await copied; return leading() ? c.syncNow() : waitFor({ op: "sync" }); }
  async function pushNow(): Promise<void> { await copied; return leading() ? c.pushNow() : waitFor({ op: "push" }); }
  async function opened(): Promise<void> {
    await copied;
    if (leading()) return c.opened();
    if (!store.notes.all().length && !store.tasks.all().length && !store.links.all().length) await waitFor({ op: "opened" });
  }

  function settle(path: string, how: Settle): boolean {
    if (leading()) return c.settle(path, how);
    const done = { mine: keepMine, theirs: takeTheirs, restore: restoreMine, dismiss: dismissLost }[how](store, path);
    if (done) { redraw(["notes"]); void waitFor({ op: "settle", path, how }); }
    return done;
  }

  function resolveRefused(r: Pick<Refusal, "kind" | "key">, how: "retry" | "discard"): boolean {
    if (leading()) return c.resolveRefused(r, how);
    const done = (how === "retry" ? retryRefused : discardRefused)(store, r.kind, r.key);
    if (done) { redraw([r.kind === "note" ? "notes" : r.kind === "task" ? "tasks" : "links"]); void waitFor({ op: "resolve", kind: r.kind, key: r.key, how }); }
    return done;
  }

  function movedTo(path: string): string {
    if (leading()) return c.movedTo(path);
    const to = moved.get(path);
    return to && !store.notes.get(path) ? to : path;
  }

  return {
    getStatus: (): SyncStatus => status,
    watchStatus(l: () => void): () => void { watchers.add(l); return () => { watchers.delete(l); }; },
    onRedraw(f: (topics?: readonly Topic[]) => void): () => void { redraws.add(f); return () => { redraws.delete(f); }; },
    beforeRound: c.beforeRound,
    movedTo, opened, syncNow, pushNow, apply, settle, resolveRefused,
    /** Background work while the app is mounted: the leader's engine. */
    start(): () => void {
      mounts++;
      if (leading() && mounts === 1) stopEngine = c.start();
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        if (--mounts) return;
        stopEngine?.(); stopEngine = undefined;
      };
    },
    /** What the realtime feed says besides records, for this tab's screens (hooks/live.ts); the leader runs the stream. */
    live(f: (e: Relayed) => void): () => void {
      live = f;
      startStream();
      return () => { live = undefined; stopStream?.(); stopStream = undefined; };
    },
    /** The page came to the front: a leader that didn't answer while it was behind is pinged again. */
    wake(): void { if (!leading() && (overdue || asks.size)) { overdue = false; probe(); } },
    /** Forget the copy, here, in IndexedDB and in every tab (each reloads). */
    clear: async (): Promise<void> => { await copied; if (leading()) await clearCopy(); else await ask({ op: "clear" }); },
    /** Whether this tab leads. */
    leading,
  };
}
