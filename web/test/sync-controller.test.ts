import { expect, test } from "bun:test";
import { Refused, Unavailable } from "@/core/record-contracts";
import { addNote, saveTask, writeNote, type Transport } from "@/core/sync";
import { newTask } from "@/core/todo";
import { tables } from "@/lib/local";
import { createSync } from "@/lib/sync-controller";

function fixture() {
  const { store } = tables(() => {});
  const queued = new Map<() => void, number>();
  const schedule = (work: () => void, ms: number) => { queued.set(work, ms); return () => { queued.delete(work); }; };
  let lists = 0, online = true;
  const unused = async (): Promise<never> => { throw new Error("Unexpected write"); };
  const transport: Transport = {
    notes: { list: async () => { lists++; return []; }, get: unused, create: unused, update: unused, remove: unused },
    tasks: { revs: async () => [], get: unused, getMany: async () => [], create: unused, update: unused, remove: unused },
    links: { ids: async () => [], byIds: unused, add: unused, remove: unused },
  };
  const sync = createSync({ store, transport, online: () => online, schedule });
  return { store, sync, transport, queued, lists: () => lists, offline: () => { online = false; } };
}

function idle(sync: ReturnType<typeof createSync>): Promise<void> {
  return new Promise((resolve) => {
    const off = sync.watchStatus(() => { if (!sync.getStatus().syncing) { off(); resolve(); } });
  });
}

test("controllers isolate stores, status and redraw subscriptions; route loaders can sync before mounting", async () => {
  const a = fixture(), b = fixture();
  const draws: (readonly string[] | undefined)[] = [];
  const unsubscribe = a.sync.onRedraw((topics) => draws.push(topics));
  await b.sync.opened();
  expect(b.lists()).toBe(1);
  expect(draws).toEqual([]);
  a.offline();
  expect(a.sync.apply([{ kind: "note.add", rec: "a1", path: "notes/a.md", text: "offline edit" }])).toBe(true);
  expect(draws).toEqual([["notes"]]);                     // a write redraws the list it touched
  expect(a.sync.getStatus().waiting).toBe(1);
  expect(b.sync.getStatus().waiting).toBe(0);
  expect(a.queued.size).toBe(0); // no background work before mount
  await a.sync.syncNow();
  expect(draws).toEqual([["notes"], undefined]);           // a sync, every list
  unsubscribe();
  await a.sync.syncNow();
  expect(draws).toHaveLength(2);
});

test("the last lifecycle owner cancels pending work, cleanup is idempotent and remount sends what waited", async () => {
  const f = fixture();
  const created: string[] = [];
  f.transport.tasks.create = async (t) => { created.push(t.id); return { ...t, rev: 1 }; };
  const mounted = idle(f.sync), first = f.sync.start(), second = f.sync.start();
  await mounted;
  f.sync.apply([{ kind: "task.save", task: newTask("t1", { title: "x" }) }]);
  expect([...f.queued.values()]).toEqual([1500]);
  first(); first();
  expect(f.queued.size).toBe(1);
  second();
  expect(f.queued.size).toBe(0);
  f.sync.apply([{ kind: "task.save", task: newTask("t2", { title: "y" }) }]);
  expect(f.queued.size).toBe(0);
  const mountedAgain = idle(f.sync), stop = f.sync.start();
  await mountedAgain;
  expect(created.sort()).toEqual(["t1", "t2"]);
  expect(f.lists()).toBe(0);                                     // a push alone: the pull comes with the realtime feed
  stop();
});

test("an edit goes up by a push alone; a pull is only what syncNow asks for", async () => {
  const f = fixture();
  f.transport.tasks.create = async (t) => ({ ...t, rev: 1 });
  const stop = f.sync.start();
  await idle(f.sync);
  f.sync.apply([{ kind: "task.save", task: newTask("t1", { title: "x" }) }]);
  const [push] = [...f.queued.keys()];
  const pushed = idle(f.sync);
  push!();
  await pushed;
  expect([f.lists(), f.sync.getStatus().waiting]).toEqual([0, 0]);
  await f.sync.syncNow();
  expect(f.lists()).toBe(1);
  stop();
});

test("a record the realtime feed reports is in the copy and its list at once, rev-checked, with no request", async () => {
  const f = fixture();
  const draws: unknown[] = [];
  f.sync.onRedraw((t) => draws.push(t));
  f.transport.tasks.create = async (t) => ({ ...t, rev: 1 });
  saveTask(f.store, newTask("t1", { title: "mine" }));
  await f.sync.syncNow();
  draws.length = 0;
  const lists = f.lists();
  f.sync.heard({ topic: "tasks", task: { ...newTask("t1", { title: "mine" }), rev: 1 } });   // this app's own write echoing back
  expect(draws).toEqual([]);
  f.sync.heard({ topic: "tasks", task: { ...newTask("t1", { title: "the phone's" }), rev: 2 } });
  expect(f.store.tasks.get("t1")).toMatchObject({ rev: 2, data: { title: "the phone's" } });
  expect(draws).toEqual([["tasks"]]);
  f.sync.heard({ topic: "tasks", gone: "t1" });
  expect(f.store.tasks.get("t1")).toBeUndefined();
  expect([f.lists(), f.queued.size]).toEqual([lists, 0]);
});

test("why the realtime feed is off is in the status until it is on again", () => {
  const f = fixture();
  f.sync.feed("Live updates are off: HTTP 404");
  expect(f.sync.getStatus().feed).toBe("Live updates are off: HTTP 404");
  f.sync.feed(undefined);
  expect(f.sync.getStatus().feed).toBeUndefined();
});

test("a failed request finishing after stop cannot rearm the retry timer", async () => {
  const f = fixture();
  addNote(f.store, "a1", "notes/a.md", "waiting");
  let reject!: (reason: Error) => void, entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  f.transport.notes.create = () => { entered(); return new Promise((_, fail) => { reject = fail; }); };
  const stop = f.sync.start();
  await started;
  const done = idle(f.sync);
  f.transport.notes.create = async () => { throw new Error("offline"); };
  stop();
  reject(new Error("offline"));
  await done;
  expect(f.sync.getStatus()).toMatchObject({ waiting: 1, syncing: false });
  expect(f.queued.size).toBe(0);
  const failedAgain = idle(f.sync), resumed = f.sync.start();
  await failedAgain;
  expect([...f.queued.values()]).toEqual([10_000]);              // the second failed round in a row: twice the first wait
  resumed();
  expect(f.queued.size).toBe(0);
});

test("retries back off exponentially to a cap and start over after a round that went through", async () => {
  const f = fixture();
  addNote(f.store, "a1", "notes/a.md", "waiting");
  let fail = true;
  const list = f.transport.notes.list;
  f.transport.notes.list = async () => { if (fail) throw new Unavailable("offline"); return list(); };
  const stop = f.sync.start();
  const waits: number[] = [];
  for (let i = 0; i < 8; i++) {
    const done = idle(f.sync);
    if (i) await f.sync.syncNow(); else await done;
    waits.push(...f.queued.values());
  }
  expect(waits).toEqual([5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]);
  fail = false;
  f.transport.notes.create = async (rec, path, text) => ({ rec, path, text, rev: 1, kind: "note" });
  await f.sync.syncNow();
  expect(f.queued.size).toBe(0);
  fail = true;
  writeNote(f.store, "notes/a.md", "again");
  await f.sync.syncNow();
  expect([...f.queued.values()]).toEqual([5_000]);
  stop();
});

test("a change the server refused is shown, not retried by itself, and is sent again or let go on the owner's word", async () => {
  const f = fixture();
  saveTask(f.store, newTask("t1", { title: "x" }));
  let creates = 0;
  f.transport.tasks.create = async () => { creates++; throw new Refused("Failed to create record. (title: too long)"); };
  const stop = f.sync.start();
  await f.sync.syncNow();
  expect(f.sync.getStatus()).toMatchObject({ waiting: 0, refused: [{ kind: "task", key: "t1", title: "x", reason: "Failed to create record. (title: too long)" }] });
  expect(f.queued.size).toBe(0);
  expect(f.sync.resolveRefused({ kind: "task", key: "t1" }, "retry")).toBe(true);
  await f.sync.syncNow();
  expect(creates).toBe(2);
  expect(f.sync.resolveRefused({ kind: "task", key: "t1" }, "discard")).toBe(true);
  expect(f.sync.getStatus().refused).toEqual([]);
  expect(f.store.tasks.get("t1")).toBeUndefined();
  stop();
});

test("a write that changes nothing schedules and redraws nothing; one the copy refuses stops there, those before it kept", async () => {
  const f = fixture();
  const draws: unknown[] = [];
  f.sync.onRedraw((t) => draws.push(t));
  const stop = f.sync.start();
  await idle(f.sync);
  f.queued.clear();
  draws.length = 0;
  expect(f.sync.apply([{ kind: "note.remove", path: "notes/none.md" }])).toBe(false);
  expect([draws, f.queued.size]).toEqual([[], 0]);
  expect(() => f.sync.apply([
    { kind: "note.add", rec: "a1", path: "notes/a.md", text: "a" },
    { kind: "note.add", rec: "a2", path: "notes/a.md", text: "taken" },
  ])).toThrow("taken");
  expect(f.store.notes.get("notes/a.md")?.text).toBe("a");
  expect(draws.at(-1)).toEqual(["notes"]);
  stop();
});

test("a round lets the work it was asked to wait for finish before it pulls", async () => {
  const f = fixture();
  const order: string[] = [];
  const list = f.transport.notes.list;
  f.transport.notes.list = async () => { order.push("pull"); return list(); };
  f.sync.beforeRound(async () => { await Promise.resolve(); order.push("typing kept"); });
  await f.sync.syncNow();
  expect(order).toEqual(["typing kept", "pull"]);
});
