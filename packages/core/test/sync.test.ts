// The sync engine (src/sync.ts) against a fake server that holds the rev contract: a write at a stale rev is a Conflict, a
// create at a taken path or id is a Conflict, a delete at a stale rev is a Conflict.
import { describe, expect, test } from "bun:test";
import { serializeNote } from "../src/notes";
import { Conflict, type Remote, type Versioned } from "../src/pocketbase";
import { sameLink, type Link } from "../src/record-links";
import {
  addLink, carryLinks, coalesced, conflicted, dismissLost, freshNote, keepMine, patch, removeLink, removeNote, removeTask, restoreMine, saveTask,
  syncRound, takeTheirs, tick, visibleLinks, waiting, writeNote,
  type LinkRow, type NoteRow, type Run, type Store, type TaskRow, type Transport,
} from "../src/sync";
import { newTask, taskOf, type Task } from "../src/todo";

const table = <R>(key: (r: R) => string) => {
  const m = new Map<string, R>();
  return { get: (k: string) => m.get(k), all: () => [...m.values()], put: (r: R) => void m.set(key(r), r), delete: (k: string) => void m.delete(k) };
};
const store = (): Store => ({ notes: table<NoteRow>((r) => r.path), tasks: table<TaskRow>((r) => r.id), links: table<LinkRow>((r) => r.link.id) });

type NoteRec = { rec: string; path: string; text: string; rev: number };

/** The server: records with revs, the calls the engine makes, and a switch to take it off the network. */
function fakeServer() {
  const notes = new Map<string, NoteRec>(), tasks = new Map<string, Versioned<Task>>(), links = new Map<string, Link>();
  let n = 0, down = false, deleted: string[] = [];
  const calls: string[] = [];
  const net = async <T>(what: string, f: () => T): Promise<T> => {
    calls.push(what);
    if (down) throw new TypeError("network");
    return f();
  };
  const remote = (r: NoteRec): Remote => ({ rec: r.rec, path: r.path, rev: r.rev, text: r.text, kind: "note" });
  const byPath = (p: string) => [...notes.values()].find((r) => r.path === p);
  const api: Transport = {
    notes: {
      list: () => net("notes.list", () => [...notes.values()].map((r) => ({ rec: r.rec, path: r.path, rev: r.rev, kind: "note" as const }))),
      get: (rec) => net("notes.get", () => { const r = notes.get(rec); return r ? remote(r) : null; }),
      read: (path) => net("notes.read", () => { const r = byPath(path); return r ? remote(r) : null; }),
      create: (path, text) => net("notes.create", () => {
        if (byPath(path)) throw new Conflict(path);
        const r = { rec: `rec${++n}`, path, text, rev: 1 };
        notes.set(r.rec, r);
        return remote(r);
      }),
      update: (e, text) => net("notes.update", () => {
        const r = notes.get(e.rec);
        if (!r) return null;
        if (r.rev !== e.rev) throw new Conflict("rev");
        const next = { ...r, text, rev: r.rev + 1 };
        notes.set(r.rec, next);
        return remote(next);
      }),
      remove: (e) => net("notes.remove", () => {
        const r = notes.get(e.rec);
        if (!r) return;
        if (r.rev !== e.rev) throw new Conflict("rev");
        notes.delete(e.rec);
        deleted.push(e.rec);
      }),
    },
    tasks: {
      revs: () => net("tasks.revs", () => [...tasks.values()].map((t) => ({ id: t.id, rev: t.rev }))),
      get: (id) => net("tasks.get", () => tasks.get(id) ?? null),
      getMany: (ids) => net("tasks.getMany", () => ids.flatMap((id) => (tasks.has(id) ? [tasks.get(id)!] : []))),
      create: (t) => net("tasks.create", () => {
        if (tasks.has(t.id)) throw new Conflict(t.id);
        const r = { ...t, rev: 1 };
        tasks.set(t.id, r);
        return r;
      }),
      update: (id, rev, fields) => net("tasks.update", () => {
        const r = tasks.get(id);
        if (!r) return null;
        if (r.rev !== rev) throw new Conflict("rev");
        const next = { ...r, ...fields, rev: r.rev + 1 };
        tasks.set(id, next);
        return next;
      }),
      remove: (id, rev) => net("tasks.remove", () => {
        const r = tasks.get(id);
        if (!r) return;
        if (r.rev !== rev) throw new Conflict("rev");
        tasks.delete(id);
        for (const [k, l] of links) if ((l.from.type === "task" && l.from.id === id) || (l.to.type === "task" && l.to.id === id)) links.delete(k);
      }),
    },
    links: {
      ids: () => net("links.ids", () => [...links.keys()]),
      byIds: (ids) => net("links.byIds", () => ids.flatMap((id) => (links.has(id) ? [links.get(id)!] : []))),
      add: (l) => net("links.add", () => {
        const had = [...links.values()].find((x) => x.id === l.id || sameLink(x, l));
        if (had) return had;
        const ends = [l.from, l.to];
        for (const e of ends) if (e.type === "task" ? !tasks.has(e.id) : ![...notes.keys()].includes(e.id)) throw Object.assign(new Error("404"), { status: 404 });
        links.set(l.id, l);
        return l;
      }),
      remove: (id) => net("links.remove", () => void links.delete(id)),
    },
    status: (e) => (e as { status?: number }).status,
  };
  return {
    api, notes, tasks, links, calls,
    get deleted() { return deleted; },
    take: (v: boolean) => { down = v; },
    /** A record another device wrote. */
    put: (path: string, text: string): NoteRec => {
      const had = byPath(path), r = { rec: had?.rec ?? `rec${++n}`, path, text, rev: (had?.rev ?? 0) + 1 };
      notes.set(r.rec, r);
      return r;
    },
    putTask: (t: Task, rev = 1) => void tasks.set(t.id, { ...t, rev }),
  };
}

const note = (title: string, body = "", extra: { pinned?: boolean; tags?: string[] } = {}) => serializeNote({ title, created: "2026-11-01", ...extra }, body);
const P = "notes/20261101-a.md";

function run(s: Store, server: ReturnType<typeof fakeServer>, over: Partial<Run> = {}) {
  const errs: string[] = [];
  const r: Run = { store: s, api: server.api, fail: (what, e) => errs.push(`${what}: ${e instanceof Error ? e.message : e}`), ...over };
  return { errs, go: () => syncRound(r) };
}

describe("coalesced", () => {
  test("a call while one runs shares it and runs once more after", async () => {
    let started = 0, release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const go = coalesced(async () => { started++; await gate; });
    const a = go(), b = go(), c = go();
    expect(go.running()).toBe(true);
    expect(b).toBe(a); expect(c).toBe(a);
    release();
    await a;
    await Bun.sleep(5);
    expect(started).toBe(2);
    expect(go.running()).toBe(false);
  });
  test("a run that never awaits still clears running", async () => {
    let started = 0;
    const go = coalesced(async () => { started++; });
    await go();
    expect(go.running()).toBe(false);
    await go();
    expect(started).toBe(2);
  });
  test("a run that throws does not wedge it", async () => {
    let started = 0;
    const go = coalesced(async () => { started++; throw new Error("x"); });
    await go();
    await go();
    expect(started).toBe(2);
  });
});

describe("notes", () => {
  test("a pull brings the server's notes down, in step with their rev", async () => {
    const server = fakeServer(), s = store();
    server.put(P, note("A", "one"));
    const { go, errs } = run(s, server);
    expect(await go()).toBe(true);
    const n = s.notes.get(P)!;
    expect([n.rev, n.base, n.text, n.rec]).toEqual([1, note("A", "one"), note("A", "one"), "rec1"]);
    expect(waiting(s)).toBe(0);
    expect(errs).toEqual([]);
  });

  test("a note's row is dated by the server's change when the transport says it", async () => {
    const server = fakeServer(), s = store();
    server.put(P, note("A", "one"));
    const get = server.api.notes.get;
    server.api.notes.get = async (rec) => { const r = await get(rec); return r && { ...r, at: 1_700_000_000_000 }; };
    await run(s, server).go();
    expect(s.notes.get(P)).toMatchObject({ updated: 1_700_000_000_000, pushed: 1_700_000_000_000 });
    server.put(P, note("A", "two"));
    await run(s, server).go();
    expect(s.notes.get(P)!.updated).toBeGreaterThan(1_700_000_000_000);
    expect(waiting(s)).toBe(0);
  });

  test("a second pull fetches only what moved", async () => {
    const server = fakeServer(), s = store();
    server.put(P, note("A", "one"));
    await run(s, server).go();
    server.calls.length = 0;
    await run(s, server).go();
    expect(server.calls).not.toContain("notes.get");
    server.put(P, note("A", "two"));
    await run(s, server).go();
    expect(s.notes.get(P)!.text).toBe(note("A", "two"));
  });

  test("an edit made offline waits, then goes up at the rev it was based on", async () => {
    const server = fakeServer(), s = store();
    server.put(P, note("A", "one"));
    await run(s, server).go();
    server.take(true);
    writeNote(s, P, note("A", "one\ntwo"));
    expect(waiting(s)).toBe(1);
    const off = run(s, server);
    expect(await off.go()).toBe(false);
    expect(waiting(s)).toBe(1);
    expect(server.calls.filter((c) => c === "notes.update")).toEqual([]);
    server.take(false);
    expect(await run(s, server).go()).toBe(true);
    expect(server.notes.get("rec1")).toMatchObject({ text: note("A", "one\ntwo"), rev: 2 });
    expect(s.notes.get(P)).toMatchObject({ rev: 2, base: note("A", "one\ntwo") });
    expect(waiting(s)).toBe(0);
  });

  test("a note made here is created, and keeps the text typed while it went up", async () => {
    const server = fakeServer(), s = store();
    writeNote(s, P, note("A", "one"));
    const create = server.api.notes.create;
    server.api.notes.create = async (path, text) => { const r = await create(path, text); writeNote(s, P, note("A", "one\nmore")); return r; };   // typed while the create is out
    await run(s, server).go();
    expect(s.notes.get(P)!.text).toBe(note("A", "one\nmore"));
    expect(waiting(s)).toBe(1);                              // the second edit is still unsent
    await run(s, server).go();
    expect(server.notes.get("rec1")!.text).toBe(note("A", "one\nmore"));
    expect(waiting(s)).toBe(0);
  });

  test("a stale rev with disjoint edits merges and goes up", async () => {
    const server = fakeServer(), s = store();
    const base = note("A", "l1\nl2\nl3\nl4\nl5");
    server.put(P, base);
    await run(s, server).go();
    writeNote(s, P, note("A", "l1 mine\nl2\nl3\nl4\nl5"));
    server.put(P, note("A", "l1\nl2\nl3\nl4\nl5 theirs"));     // another device, meanwhile
    const r = run(s, server);
    // the pull would take their text only if ours were not unsent: it is not
    await r.go();
    const want = note("A", "l1 mine\nl2\nl3\nl4\nl5 theirs");
    expect(server.notes.get("rec1")).toMatchObject({ text: want, rev: 3 });
    expect(s.notes.get(P)).toMatchObject({ text: want, rev: 3, base: want, conflict_rev: null });
    expect(conflicted(s)).toEqual([]);
    expect(waiting(s)).toBe(0);
  });

  test("overlapping edits are a conflict; keeping mine sends it over theirs", async () => {
    const server = fakeServer(), s = store();
    server.put(P, note("A", "one"));
    await run(s, server).go();
    writeNote(s, P, note("A", "mine"));
    server.put(P, note("A", "theirs"));
    await run(s, server).go();
    const n = s.notes.get(P)!;
    expect([n.conflict_text, n.conflict_rev, n.text]).toEqual([note("A", "theirs"), 2, note("A", "mine")]);
    expect(conflicted(s)).toEqual([P]);
    expect(server.notes.get("rec1")!.text).toBe(note("A", "theirs"));
    await run(s, server).go();                                  // a conflicted row is left alone, not retried
    expect(server.notes.get("rec1")!.rev).toBe(2);
    expect(keepMine(s, P)).toBe(true);
    expect(keepMine(s, P)).toBe(false);                          // a second tap
    await run(s, server).go();
    expect(server.notes.get("rec1")).toMatchObject({ text: note("A", "mine"), rev: 3 });
    expect(conflicted(s)).toEqual([]);
  });

  test("taking theirs keeps mine to restore, and restoring sends it", async () => {
    const server = fakeServer(), s = store();
    server.put(P, note("A", "one"));
    await run(s, server).go();
    writeNote(s, P, note("A", "mine"));
    server.put(P, note("A", "theirs"));
    await run(s, server).go();
    expect(takeTheirs(s, P)).toBe(true);
    expect(s.notes.get(P)).toMatchObject({ text: note("A", "theirs"), lost: note("A", "mine"), conflict_rev: null });
    expect(waiting(s)).toBe(0);
    expect(conflicted(s)).toEqual([P]);                          // the replaced text still waits for a decision
    expect(restoreMine(s, P)).toBe(true);
    await run(s, server).go();
    expect(server.notes.get("rec1")!.text).toBe(note("A", "mine"));
    expect(dismissLost(s, P)).toBe(false);
  });

  test("a new note whose path the server took moves aside to -2", async () => {
    const server = fakeServer(), s = store();
    server.put("notes/20261101-untitled.md", note("Untitled", "theirs"));
    writeNote(s, "notes/20261101-untitled.md", note("Untitled", "mine"));
    const moves: [string, string][] = [];
    const r = run(s, server, { moved: (a, b) => moves.push([a, b]) });
    await r.go();
    expect(moves).toEqual([["notes/20261101-untitled.md", "notes/20261101-untitled-2.md"]]);
    await run(s, server).go();                                 // the next pull brings the server's own note down
    expect(s.notes.get("notes/20261101-untitled.md")!.text).toBe(note("Untitled", "theirs"));
    expect(s.notes.get("notes/20261101-untitled-2.md")).toMatchObject({ text: note("Untitled", "mine"), rev: 1 });
    expect([...server.notes.values()].map((x) => x.path).sort()).toEqual(["notes/20261101-untitled-2.md", "notes/20261101-untitled.md"]);
  });

  test("a create that landed once before is not a second note", async () => {
    const server = fakeServer(), s = store();
    server.put(P, note("A", "same"));
    writeNote(s, P, note("A", "same"));
    await run(s, server).go();
    expect([...server.notes.keys()]).toEqual(["rec1"]);
    expect(s.notes.get(P)).toMatchObject({ rec: "rec1", rev: 1 });
    expect(waiting(s)).toBe(0);
  });

  test("a delete is a tombstone, sent with its rev; a note the server never had is gone at once", async () => {
    const server = fakeServer(), s = store();
    server.put(P, note("A", "one"));
    await run(s, server).go();
    writeNote(s, "notes/20261101-b.md", note("B"));
    expect(removeNote(s, "notes/20261101-b.md", false)).toBe(true);
    expect(s.notes.get("notes/20261101-b.md")).toBeUndefined();
    expect(removeNote(s, P, false)).toBe(true);
    expect(s.notes.get(P)!.deleted).toBe(true);
    expect(waiting(s)).toBe(1);
    await run(s, server).go();
    expect(server.deleted).toEqual(["rec1"]);
    expect(s.notes.get(P)).toBeUndefined();
  });

  test("a delete of a note edited on the server since brings it back with that edit", async () => {
    const server = fakeServer(), s = store();
    server.put(P, note("A", "one"));
    await run(s, server).go();
    removeNote(s, P, false);
    server.put(P, note("A", "edited elsewhere"));
    await run(s, server).go();
    expect(s.notes.get(P)).toMatchObject({ text: note("A", "edited elsewhere"), deleted: false, rev: 2 });
    expect(server.notes.has("rec1")).toBe(true);
  });

  test("gone from the server: dropped here, unless edited here, which puts it back", async () => {
    const server = fakeServer(), s = store();
    server.put(P, note("A", "one"));
    server.put("notes/20261101-b.md", note("B", "one"));
    await run(s, server).go();
    server.notes.clear();
    writeNote(s, "notes/20261101-b.md", note("B", "edited"));
    await run(s, server).go();
    expect(s.notes.get(P)).toBeUndefined();
    expect(s.notes.get("notes/20261101-b.md")).toMatchObject({ text: note("B", "edited"), rev: 1 });
    expect([...server.notes.values()].map((r) => r.path)).toEqual(["notes/20261101-b.md"]);
  });

  test("notes outside notes/ are not synced", async () => {
    const server = fakeServer(), s = store();
    server.put("agent/memory.md", "who I am");
    await run(s, server).go();
    expect(s.notes.all()).toEqual([]);
  });

  test("an unreachable server ends the round after the pull and leaves every edit unsent", async () => {
    const server = fakeServer(), s = store();
    writeNote(s, P, note("A", "one"));
    saveTask(s, newTask("t1", { title: "x" }));
    server.take(true);
    const r = run(s, server);
    expect(await r.go()).toBe(false);
    expect(server.calls).toEqual(["notes.list"]);
    expect(waiting(s)).toBe(2);
    expect(r.errs.length).toBe(1);
  });

  test("an edit while a sync is out outlives it", () => {
    const s = store();
    s.notes.put({ ...freshNote(P, note("A"), 1), rec: "r", rev: 1, base: note("A"), pushed: 1 });
    writeNote(s, P, note("A", "x"));
    expect(s.notes.get(P)!.updated).toBeGreaterThan(s.notes.get(P)!.pushed!);
    expect(tick({ updated: Date.now() + 1000 })).toBeGreaterThan(Date.now() + 1000);
  });
});

describe("tasks", () => {
  const task = (over: Partial<Task> = {}) => newTask("task1", { title: "Buy milk", ...over });

  test("a task made offline goes up under its own id", async () => {
    const server = fakeServer(), s = store();
    saveTask(s, task());
    await run(s, server).go();
    expect(server.tasks.get("task1")).toMatchObject({ title: "Buy milk", rev: 1 });
    expect(s.tasks.get("task1")).toMatchObject({ rev: 1, pushed: s.tasks.get("task1")!.updated });
    expect(waiting(s)).toBe(0);
  });

  test("a stale rev merges field by field; the local edit wins a field both changed", async () => {
    const server = fakeServer(), s = store();
    server.putTask(task({ notes: "a", when: "" }));
    await run(s, server).go();
    const mine = s.tasks.get("task1")!;
    saveTask(s, { ...mine.data, title: "Mine", notes: "local" });
    server.putTask({ ...mine.data, title: "Theirs", when: "2026-11-09" }, 2);
    const r = run(s, server);
    await r.go();
    const out = server.tasks.get("task1")!;
    expect(out).toMatchObject({ title: "Mine", notes: "local", when: "2026-11-09", rev: 3 });
    expect(s.tasks.get("task1")).toMatchObject({ rev: 3 });
    expect(waiting(s)).toBe(0);
    expect(conflicted(s)).toEqual([]);
  });

  test("tags merge as a set and a checklist by item id", async () => {
    const server = fakeServer(), s = store();
    server.putTask(task({ tags: ["a"] }));
    await run(s, server).go();
    const mine = s.tasks.get("task1")!.data;
    saveTask(s, { ...mine, tags: ["a", "b"] });
    server.putTask({ ...mine, tags: ["a", "c"] }, 2);
    await run(s, server).go();
    expect([...server.tasks.get("task1")!.tags].sort()).toEqual(["a", "b", "c"]);
  });

  test("a delete is a tombstone with its rev; one edited on the server since comes back", async () => {
    const server = fakeServer(), s = store();
    server.putTask(task());
    server.putTask(task({ title: "Other" }), 1);
    server.tasks.set("task2", { ...task({ title: "Two" }), id: "task2", rev: 1 });
    await run(s, server).go();
    removeTask(s, "task1", false);
    removeTask(s, "task2", false);
    server.tasks.set("task2", { ...server.tasks.get("task2")!, title: "Two, edited", rev: 2 });
    await run(s, server).go();
    expect(server.tasks.has("task1")).toBe(false);
    expect(s.tasks.get("task1")).toBeUndefined();
    expect(s.tasks.get("task2")).toMatchObject({ deleted: false, rev: 2 });
    expect(taskOf(s.tasks.get("task2")!.data).title).toBe("Two, edited");
  });

  test("a task the server no longer has is dropped, unless edited here", async () => {
    const server = fakeServer(), s = store();
    server.putTask(task());
    server.tasks.set("task2", { ...task({ title: "Two" }), id: "task2", rev: 1 });
    await run(s, server).go();
    server.tasks.clear();
    saveTask(s, { ...s.tasks.get("task2")!.data, title: "Edited" });
    await run(s, server).go();
    expect(s.tasks.get("task1")).toBeUndefined();
    expect(server.tasks.get("task2")).toMatchObject({ title: "Edited", rev: 1 });
  });
});

describe("links", () => {
  const ids = (() => { let i = 0; return () => `lnk${++i}`; })();

  test("an add waits for its task, then goes up; a remove is a tombstone", async () => {
    const server = fakeServer(), s = store();
    const n = server.put(P, note("A"));
    saveTask(s, newTask("task1", { title: "x" }));
    const id = addLink(s, ids(), { type: "task", id: "task1" }, { type: "note", id: n.rec }, "about");
    await run(s, server).go();
    expect(server.links.has(id)).toBe(true);
    expect(s.links.get(id)!.pushed).not.toBeNull();
    removeLink(s, id, false);
    expect(visibleLinks(s)).toEqual([]);
    expect(waiting(s)).toBe(1);
    await run(s, server).go();
    expect(server.links.size).toBe(0);
    expect(s.links.get(id)).toBeUndefined();
  });

  test("a link whose task is not up yet waits a round, not forever", async () => {
    const server = fakeServer(), s = store();
    const n = server.put(P, note("A"));
    saveTask(s, newTask("task1", { title: "x" }));
    const id = addLink(s, ids(), { type: "task", id: "task1" }, { type: "note", id: n.rec }, "about");
    s.tasks.put({ ...s.tasks.get("task1")!, rev: null });
    // a round in which the task's create fails: the link stays unsent, and is not dropped
    server.api.tasks.create = async () => { throw Object.assign(new Error("boom"), { status: 500 }); };
    const r = run(s, server);
    await r.go();
    expect(s.links.get(id)).toMatchObject({ pushed: null });
    expect(server.links.size).toBe(0);
  });

  test("the server's copy under its own id is taken, and an add is idempotent", async () => {
    const server = fakeServer(), s = store();
    const n = server.put(P, note("A"));
    saveTask(s, newTask("task1", { title: "x" }));
    server.putTask(newTask("task1", { title: "x" }));
    server.links.set("theirs", { id: "theirs", from: { type: "task", id: "task1" }, to: { type: "note", id: n.rec }, role: "about" });
    const mine = addLink(s, "mine1", { type: "task", id: "task1" }, { type: "note", id: n.rec }, "about");
    s.links.delete("theirs");
    await run(s, server).go();
    expect(s.links.get(mine)).toBeUndefined();
    expect(s.links.get("theirs")).toBeDefined();
    expect(server.links.size).toBe(1);
    expect(addLink(s, "again", { type: "task", id: "task1" }, { type: "note", id: n.rec }, "about")).toBe("theirs");
  });

  test("a 404 drops the link: an end is gone from the server", async () => {
    const server = fakeServer(), s = store();
    saveTask(s, newTask("task1", { title: "x" }));
    const id = addLink(s, ids(), { type: "task", id: "task1" }, { type: "note", id: "nosuchnote" }, "about");
    const r = run(s, server);
    await r.go();
    expect(s.links.get(id)).toBeUndefined();
    expect(r.errs).toEqual([]);
  });

  test("a link whose task is deleted here is never shown and, unsent, dropped", async () => {
    const server = fakeServer(), s = store();
    const n = server.put(P, note("A"));
    saveTask(s, newTask("task1", { title: "x" }));
    const id = addLink(s, ids(), { type: "task", id: "task1" }, { type: "note", id: n.rec }, "about");
    removeTask(s, "task1", false);
    expect(visibleLinks(s)).toEqual([]);
    await run(s, server).go();
    expect(s.links.get(id)).toBeUndefined();
    expect(server.links.size).toBe(0);
  });

  test("a link the server no longer has is gone here; one made here is kept", async () => {
    const server = fakeServer(), s = store();
    const n = server.put(P, note("A"));
    server.putTask(newTask("task1", { title: "x" }));
    server.links.set("l1", { id: "l1", from: { type: "task", id: "task1" }, to: { type: "note", id: n.rec }, role: "about" });
    await run(s, server).go();
    expect(visibleLinks(s).map((l) => l.id)).toEqual(["l1"]);
    server.links.clear();
    await run(s, server).go();
    expect(s.links.all()).toEqual([]);
  });

  test("a repeating task's next round gets its links again", () => {
    const s = store();
    saveTask(s, newTask("task1", { title: "x" }));
    saveTask(s, newTask("task2", { title: "x" }));
    addLink(s, "l1", { type: "task", id: "task1" }, { type: "note", id: "n1" }, "about");
    let i = 0;
    carryLinks(s, "task1", "task2", () => `new${++i}`);
    expect(visibleLinks(s).map((l) => [l.id, l.from.id])).toEqual([["l1", "task1"], ["new1", "task2"]]);
  });
});

describe("waiting", () => {
  test("counts unsent and deleted rows, not those in step", () => {
    const s = store();
    expect(waiting(s)).toBe(0);
    s.notes.put({ ...freshNote(P, "x", 1), rev: 1, rec: "r", pushed: 1 });
    expect(waiting(s)).toBe(0);
    patch(s.notes, P, { updated: 5 });
    expect(waiting(s)).toBe(1);
  });
});
