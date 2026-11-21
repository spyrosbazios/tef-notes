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
  const sync = createSync({ store, ready: Promise.resolve(), transport, online: () => online, schedule });
  return { store, sync, transport, queued, lists: () => lists, offline: () => { online = false; } };
}

function idle(sync: ReturnType<typeof createSync>): Promise<void> {
  return new Promise((resolve) => {
    const off = sync.watchStatus(() => { if (!sync.getStatus().syncing) { off(); resolve(); } });
  });
}

test("controllers isolate stores, status and redraw subscriptions; route loaders can sync before mounting", async () => {
  const a = fixture(), b = fixture();
  let draws = 0;
  const unsubscribe = a.sync.onRedraw(() => draws++);
  await b.sync.opened();
  expect(b.lists()).toBe(1);
  expect(draws).toBe(0);
  a.offline();
  addNote(a.store, "a1", "notes/a.md", "offline edit");
  a.sync.edited();
  expect(a.sync.getStatus().waiting).toBe(1);
  expect(b.sync.getStatus().waiting).toBe(0);
  expect(a.queued.size).toBe(0); // no background work before mount
  await a.sync.syncNow();
  expect(draws).toBe(1);
  unsubscribe();
  await a.sync.syncNow();
  expect(draws).toBe(1);
});

test("the last lifecycle owner cancels pending work, cleanup is idempotent and remount restarts", async () => {
  const f = fixture();
  const mounted = idle(f.sync), first = f.sync.start(), second = f.sync.start();
  await mounted;
  f.sync.edited();
  f.sync.heard("links", "create", { id: "news" });
  expect([...f.queued.values()].sort((a, b) => a - b)).toEqual([250, 1500]);
  first(); first();
  expect(f.queued.size).toBe(2);
  second();
  expect(f.queued.size).toBe(0);
  f.sync.edited();
  f.sync.heard("links", "create", { id: "later" });
  expect(f.queued.size).toBe(0);
  const before = f.lists(), mountedAgain = idle(f.sync), stop = f.sync.start();
  await mountedAgain;
  expect(f.lists()).toBeGreaterThan(before);
  stop();
});

test("a failed request finishing after stop cannot rearm the retry timer", async () => {
  const f = fixture();
  addNote(f.store, "a1", "notes/a.md", "waiting");
  let reject!: (reason: Error) => void, entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  f.transport.notes.list = () => { entered(); return new Promise((_, fail) => { reject = fail; }); };
  const stop = f.sync.start();
  await started;
  const done = idle(f.sync);
  f.transport.notes.list = async () => { throw new Error("offline"); };
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
