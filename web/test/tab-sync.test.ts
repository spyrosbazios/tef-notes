// One tab writes the copy, the others mirror it (lib/tab-sync.ts), over a fake channel, a fake lock and a fake IndexedDB shared by
// tabs in one "browser": a follower's writes reach the leader's copy and storage, the leader's reach every follower, and the
// lead passes on when the leader closes or stops answering.
import { expect, test } from "bun:test";
import type { Change } from "@/core/changes";
import { freshNote, type Transport } from "@/core/sync";
import { newTask } from "@/core/todo";
import { tables } from "@/lib/local";
import { createSync } from "@/lib/sync-controller";
import { createTabs, STEAL_AFTER, type Lock, type Message, type Relayed, type Rows, type StreamHandlers } from "@/lib/tab-sync";

type Req = { owner: string; granted: () => void; reject: (e: Error) => void };

/** Tabs of one browser: a channel delivering in order to every other open tab (held while a tab is frozen), one lock with a
 *  queue and stealing, and one IndexedDB copy (`idb`, by storage key). */
function browser() {
  const listeners = new Map<string, (m: Message) => void>(), frozen = new Map<string, Message[]>(), closed = new Set<string>();
  const idb = new Map<string, unknown>();
  let holder: Req | null = null, queue: Req[] = [];
  const grant = (r: Req) => { holder = r; r.granted(); };
  const deliver = (to: string, m: Message) => {
    if (closed.has(to)) return;
    const held = frozen.get(to);
    if (held) held.push(m); else listeners.get(to)?.(m);
  };
  const lock = (owner: string): Lock => ({ steal, signal }, granted) => new Promise<void>((_, reject) => {
    const r = { owner, granted, reject };
    if (steal) { holder?.reject(new DOMException("stolen", "AbortError")); grant(r); return; }
    if (!holder) { grant(r); return; }
    queue.push(r);
    signal?.addEventListener("abort", () => {
      if (!queue.includes(r)) return;
      queue = queue.filter((x) => x !== r);
      reject(new DOMException("aborted", "AbortError"));
    });
  });
  return {
    idb, lock,
    channel: (owner: string) => ({
      post: (m: Message) => { const copy = structuredClone(m); for (const to of listeners.keys()) if (to !== owner) queueMicrotask(() => deliver(to, copy)); },
      listen: (f: (m: Message) => void) => { listeners.set(owner, f); return () => { listeners.delete(owner); }; },
    }),
    freeze: (tab: string) => { frozen.set(tab, []); },
    thaw: (tab: string) => { const held = frozen.get(tab) ?? []; frozen.delete(tab); for (const m of held) listeners.get(tab)?.(m); },
    /** The tab's page gone: it hears nothing more and its lock goes to the next in the queue. */
    close: (tab: string) => {
      closed.add(tab);
      queue = queue.filter((r) => r.owner !== tab);
      if (holder?.owner === tab) { holder = null; const next = queue.shift(); if (next) grant(next); }
    },
  };
}

const KEYS = { notes: "n:", tasks: "t:", links: "l:" } as const;

const transport = (): Transport => {
  const fail = async (): Promise<never> => { throw new Error("not in these tests"); };
  return {
    notes: { list: async () => [], get: async () => null, create: async (rec, path, text) => ({ rec, path, text, rev: 1, kind: "note" }), update: fail, remove: fail },
    tasks: { revs: async () => [], get: fail, getMany: async () => [], create: async (t) => ({ ...t, rev: 1 }), update: fail, remove: fail },
    links: { ids: async () => [], byIds: fail, add: fail, remove: fail },
  };
};

/** A tab of `b`, named `name`: its memory copy, its engine, and its part. `visible`: whether it is in front. */
function tab(b: ReturnType<typeof browser>, name: string) {
  const writers = new Set<(t: "notes" | "tasks" | "links", key: string, row: unknown) => void>();
  const { store } = tables((t, key, row) => { for (const w of writers) w(t, key, row); });
  const timers: (() => void)[] = [], reloads: string[] = [];
  let keeping: (() => void) | undefined, stream: StreamHandlers | undefined;
  const state = { visible: true };
  const controller = createSync({ store, transport: transport(), online: () => true });
  const tabs = createTabs({
    tab: name, store, controller,
    writes: (w) => { writers.add(w); return () => { writers.delete(w); }; },
    read: async (): Promise<Rows> => {
      const rows: Rows = { notes: [], tasks: [], links: [] };
      for (const [k, r] of b.idb) {
        if (k.startsWith("n:")) rows.notes.push([k.slice(2), structuredClone(r) as never]);
        else if (k.startsWith("t:")) rows.tasks.push([k.slice(2), structuredClone(r) as never]);
        else if (k.startsWith("l:")) rows.links.push([k.slice(2), structuredClone(r) as never]);
      }
      return rows;
    },
    keep: (on) => {
      keeping?.();
      keeping = undefined;
      if (!on) return;
      const w = (t: keyof typeof KEYS, key: string, row: unknown) => { if (row === null) b.idb.delete(KEYS[t] + key); else b.idb.set(KEYS[t] + key, structuredClone(row)); };
      writers.add(w);
      keeping = () => { writers.delete(w); };
    },
    flush: async () => {},
    clear: async () => { b.idb.clear(); },
    channel: b.channel(name), lock: b.lock(name),
    stream: (h) => { stream = h; return () => { stream = undefined; }; },
    visible: () => state.visible,
    reload: () => { reloads.push(name); },
    schedule: (work) => { timers.push(work); return () => {}; },
  });
  return { name, store, tabs, timers, reloads, state, stream: () => stream };
}

/** Every message and promise in flight settled. */
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise<void>((r) => setTimeout(r, 0)); };
const notesOf = (s: ReturnType<typeof tab>["store"]) => s.notes.all().map((n) => [n.path, n.text]).sort();
const idbNotes = (b: ReturnType<typeof browser>) => [...b.idb].filter(([k]) => k.startsWith("n:")).map(([k, r]) => [k.slice(2), (r as { text: string }).text]).sort();
const add = (rec: string, path: string, text: string): Change => ({ kind: "note.add", rec, path, text });
const write = (rec: string, path: string, text: string): Change => ({ kind: "note.write", rec, path, text });

test("the first tab leads from IndexedDB; the next follows with the leader's copy", async () => {
  const b = browser();
  b.idb.set("n:notes/kept.md", freshNote("k1", "notes/kept.md", "from the last visit", 1));
  const a = tab(b, "A");
  await settle();
  const f = tab(b, "B");
  await f.tabs.opened();
  expect([a.tabs.leading(), f.tabs.leading()]).toEqual([true, false]);
  expect(notesOf(f.store)).toEqual([["notes/kept.md", "from the last visit"]]);
});

test("a follower's write shows in its copy at once and lands in the leader's copy and IndexedDB; the leader's reach the follower", async () => {
  const b = browser(), a = tab(b, "A");
  await settle();
  const f = tab(b, "B");
  await settle();
  const draws: unknown[] = [];
  f.tabs.onRedraw((t) => draws.push(t));
  expect(f.tabs.apply([add("r1", "notes/b.md", "typed in B")])).toBe(true);
  expect(notesOf(f.store)).toEqual([["notes/b.md", "typed in B"]]);   // read back at once, as the leader would
  expect(draws).toEqual([["notes"]]);
  await settle();
  expect(notesOf(a.store)).toEqual([["notes/b.md", "typed in B"]]);
  expect(idbNotes(b)).toEqual([["notes/b.md", "typed in B"]]);
  a.tabs.apply([{ kind: "task.save", task: newTask("t1", { title: "made in A" }) }]);
  await settle();
  expect(f.store.tasks.get("t1")?.data.title).toBe("made in A");
  expect(f.tabs.getStatus().waiting).toBe(2);                         // the leader's status, every tab's
});

test("two tabs typing at once never overwrite each other's unsent edits in IndexedDB", async () => {
  const b = browser(), a = tab(b, "A");
  await settle();
  const f = tab(b, "B");
  await settle();
  a.tabs.apply([add("r1", "notes/one.md", "one")]);
  f.tabs.apply([add("r2", "notes/two.md", "two")]);
  await settle();
  a.tabs.apply([write("r2", "notes/two.md", "two, edited in A")]);
  f.tabs.apply([write("r1", "notes/one.md", "one, edited in B")]);
  a.tabs.apply([add("r3", "notes/three.md", "three")]);
  await settle();
  const all = [["notes/one.md", "one, edited in B"], ["notes/three.md", "three"], ["notes/two.md", "two, edited in A"]];
  expect(idbNotes(b)).toEqual(all);
  expect(notesOf(a.store)).toEqual(all);
  expect(notesOf(f.store)).toEqual(all);
});

test("a follower's guess the leader can't take is put right by the leader's rows", async () => {
  const b = browser(), a = tab(b, "A");
  await settle();
  const f = tab(b, "B");
  await settle();
  a.tabs.apply([add("r1", "notes/x.md", "A's")]);
  f.tabs.apply([add("r2", "notes/x.md", "B's, made before it heard of A's")]);   // B's copy didn't have it yet
  await settle();
  expect(notesOf(f.store)).toEqual([["notes/x.md", "A's"]]);
  expect(f.store.notes.get("notes/x.md")?.rec).toBe("r1");
});

test("when the leader closes, the next tab leads from IndexedDB and does what it never heard back about", async () => {
  const b = browser(), a = tab(b, "A");
  await settle();
  const f = tab(b, "B"), g = tab(b, "C");
  await settle();
  a.tabs.apply([add("r1", "notes/kept.md", "kept by A")]);
  await settle();
  f.tabs.apply([add("r2", "notes/late.md", "sent as A closed")]);
  g.tabs.apply([add("r3", "notes/later.md", "sent by C as A closed")]);
  b.close("A");                                                       // before either message reached it
  await settle();
  expect(f.tabs.leading()).toBe(true);
  const all = [["notes/kept.md", "kept by A"], ["notes/late.md", "sent as A closed"], ["notes/later.md", "sent by C as A closed"]];
  expect(idbNotes(b)).toEqual(all);
  expect(notesOf(g.store)).toEqual(all);
});

test("a leader that doesn't answer while a follower is in front loses the lead, and follows once it runs again", async () => {
  const b = browser(), a = tab(b, "A");
  await settle();
  const f = tab(b, "B");
  await settle();
  for (const t of f.timers.splice(0)) t();                            // the pings on joining, answered
  b.freeze("A");                                                      // a background tab the phone froze
  f.tabs.apply([add("r1", "notes/b.md", "typed in B")]);
  await settle();
  expect(f.timers).toHaveLength(1);                                   // the ping's wait (STEAL_AFTER)
  expect(STEAL_AFTER).toBe(5000);
  f.timers.shift()!();
  await settle();
  expect(f.tabs.leading()).toBe(true);
  expect(a.tabs.leading()).toBe(false);                               // its lock was taken; it gave up the engine and storage
  expect(idbNotes(b)).toEqual([["notes/b.md", "typed in B"]]);
  b.thaw("A");
  await settle();
  expect(notesOf(a.store)).toEqual([["notes/b.md", "typed in B"]]);
  a.tabs.apply([write("r1", "notes/b.md", "typed in A, now following")]);
  await settle();
  expect(idbNotes(b)).toEqual([["notes/b.md", "typed in A, now following"]]);
});

test("a follower behind waits for the page to come to the front before taking the lead", async () => {
  const b = browser(), a = tab(b, "A");
  await settle();
  const f = tab(b, "B");
  await settle();
  for (const t of f.timers.splice(0)) t();                            // the pings on joining, answered
  b.freeze("A");
  f.state.visible = false;
  f.tabs.apply([add("r1", "notes/b.md", "x")]);
  await settle();
  f.timers.shift()!();
  await settle();
  expect(f.tabs.leading()).toBe(false);
  f.state.visible = true;
  f.tabs.wake();
  f.timers.shift()!();
  await settle();
  expect([f.tabs.leading(), a.tabs.leading()]).toEqual([true, false]);
});

test("what the leader's stream hears besides records reaches every tab; a record goes into the leader's copy and on", async () => {
  const b = browser(), a = tab(b, "A");
  await settle();
  const f = tab(b, "B");
  await settle();
  const heardA: Relayed[] = [], heardB: Relayed[] = [];
  a.tabs.live((e) => heardA.push(e));
  f.tabs.live((e) => heardB.push(e));
  expect(f.stream()).toBeUndefined();                                 // only the leader runs the stream
  a.stream()!.relay({ topic: "chats" });
  a.stream()!.heard({ topic: "tasks", task: { ...newTask("t1", { title: "from the phone" }), rev: 1 } });
  await settle();
  expect([heardA, heardB]).toEqual([[{ topic: "chats" }], [{ topic: "chats" }]]);
  expect(f.store.tasks.get("t1")?.data.title).toBe("from the phone");
});

test("a follower's sync waits for the leader's round", async () => {
  const b = browser(), a = tab(b, "A");
  await settle();
  const f = tab(b, "B");
  await settle();
  f.tabs.apply([{ kind: "task.save", task: newTask("t1", { title: "x" }) }]);
  await f.tabs.syncNow();
  expect([a.store.tasks.get("t1")?.rev, f.store.tasks.get("t1")?.rev]).toEqual([1, 1]);
  expect(f.tabs.getStatus().waiting).toBe(0);
});

test("forgetting the copy is the leader's, and every tab reloads", async () => {
  const b = browser(), a = tab(b, "A");
  await settle();
  const f = tab(b, "B"), g = tab(b, "C");
  await settle();
  a.tabs.apply([add("r1", "notes/a.md", "a")]);
  await settle();
  await f.tabs.clear();
  await settle();
  expect(b.idb.size).toBe(0);
  expect([...a.reloads, ...f.reloads, ...g.reloads].sort()).toEqual(["A", "B", "C"]);
});
