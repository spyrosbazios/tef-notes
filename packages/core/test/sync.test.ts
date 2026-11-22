// The sync engine (src/sync.ts) against a fake server that holds the rev contract: a write at a stale rev is a Conflict, a
// create at a taken path or id is a Conflict, a delete at a stale rev is a Conflict. Its other failures are what PocketBase
// answers (server/integration/contract.ts pins them), read by the protocol's own `outcomeOf`.
import { describe, expect, test } from "bun:test";
import { serializeNote } from "../src/notes";
import { Conflict, Unavailable, type Remote, type Versioned } from "../src/record-contracts";
import { outcomeOf } from "../src/record-protocol";
import { sameLink, type Link } from "../src/record-links";
import {
  addLink, addNote, coalesced, conflicted, discardRefused, dismissLost, freshNote, keepMine, patch, refusals, removeLink, removeNote, removeTask,
  restoreMine, retryRefused, saveTask, syncRound, takeHeard, takeTheirs, visibleLinks, waiting, writeNote,
  type LinkRow, type NoteRow, type Run, type Store, type TaskRow, type Transport,
} from "../src/sync";
import { newTask, taskOf, type Task } from "../src/todo";

const table = <R>(key: (r: R) => string) => {
  const m = new Map<string, R>();
  return { get: (k: string) => m.get(k), all: () => [...m.values()], put: (r: R) => void m.set(key(r), r), delete: (k: string) => void m.delete(k) };
};
const store = (): Store => ({ notes: table<NoteRow>((r) => r.path), tasks: table<TaskRow>((r) => r.id), links: table<LinkRow>((r) => r.link.id), now: Date.now });

type NoteRec = { rec: string; path: string; text: string; rev: number };

/** The server: records with revs, the calls the engine makes, and a switch to take it off the network. */
function fakeServer() {
  const notes = new Map<string, NoteRec>(), tasks = new Map<string, Versioned<Task>>(), links = new Map<string, Link>();
  let n = 0, down = false, deleted: string[] = [];
  const calls: string[] = [];
  const net = async <T>(what: string, f: () => T): Promise<T> => {
    calls.push(what);
    if (down) throw new Unavailable("network");
    return f();
  };
  const remote = (r: NoteRec): Remote => ({ rec: r.rec, path: r.path, rev: r.rev, text: r.text, kind: "note" });
  const byPath = (p: string) => [...notes.values()].find((r) => r.path === p);
  const api: Transport = {
    notes: {
      list: () => net("notes.list", () => [...notes.values()].map((r) => ({ rec: r.rec, path: r.path, rev: r.rev, kind: "note" as const }))),
      get: (rec) => net("notes.get", () => { const r = notes.get(rec); return r ? remote(r) : null; }),
      create: (rec, path, text) => net("notes.create", () => {
        if (notes.has(rec) || byPath(path)) throw new Conflict(path);
        const r = { rec, path, text, rev: 1 };
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
        for (const e of ends) if (e.type === "task" ? !tasks.has(e.id) : ![...notes.keys()].includes(e.id)) throw outcomeOf(400, { message: "Failed to create record.", data: { [`${e === l.from ? "from" : "to"}${e.type === "task" ? "Task" : "Note"}`]: { code: "validation_missing_rel_records", message: "Failed to find all relation records with the provided ids." } } }, "links");
        links.set(l.id, l);
        return l;
      }),
      remove: (id) => net("links.remove", () => void links.delete(id)),
    },
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
  return { errs, go: () => syncRound(r, { pull: true }), push: () => syncRound(r, { pull: false }) };
}

describe("coalesced", () => {
  test("calls while one runs share one rerun after it, and their promise is that rerun's", async () => {
    let started = 0, seen = 0, release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let server = 0;
    const go = coalesced(async () => { started++; const at = server; await gate; seen = at; });
    const a = go();
    server = 1;                                                // a write lands while the first run is out
    const b = go(), c = go();
    expect(go.running()).toBe(true);
    expect(b).not.toBe(a); expect(c).toBe(b);
    release();
    await a;
    expect(seen).toBe(0);
    await b;
    expect(seen).toBe(1);                                      // the caller that arrived mid-run sees the write
    expect(started).toBe(2);
    expect(go.running()).toBe(false);
    await go();
    expect(started).toBe(3);
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
  test("a write of someone else's text goes up with the tainted mark, once; the owner's own writes carry none", async () => {
    const server = fakeServer(), s = store(), marks: string[] = [];
    const { create, update } = server.api.notes;
    server.api.notes.create = (rec, path, text, mark) => { marks.push(`create ${JSON.stringify(mark)}`); return create(rec, path, text, mark); };
    server.api.notes.update = (e, text, mark) => { marks.push(`update ${JSON.stringify(mark)}`); return update(e, text, mark); };
    addNote(s, "r1", P, note("A", "mine"));
    await run(s, server).go();
    writeNote(s, P, note("A", "mine\n> **Summary**\n> a model's words"), { tainted: true });
    writeNote(s, P, note("A", "mine, typed on\n> **Summary**\n> a model's words"));      // typed on before the push: still marked
    expect(s.notes.get(P)!.tainted).toBe(true);
    await run(s, server).go();
    expect(s.notes.get(P)!.tainted).toBeUndefined();                                    // the server keeps it from now on
    writeNote(s, P, note("A", "mine, later"));
    await run(s, server).go();
    expect(marks).toEqual(["create {}", 'update {"tainted":true}', "update {}"]);
  });

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
    addNote(s, "mine1", P, note("A", "one"));
    const create = server.api.notes.create;
    server.api.notes.create = async (rec, path, text, mark) => { const r = await create(rec, path, text, mark); writeNote(s, P, note("A", "one\nmore")); return r; };   // typed while the create is out
    await run(s, server).go();
    expect(s.notes.get(P)!.text).toBe(note("A", "one\nmore"));
    expect(waiting(s)).toBe(1);                              // the second edit is still unsent
    await run(s, server).go();
    expect(server.notes.get("mine1")!.text).toBe(note("A", "one\nmore"));
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
    addNote(s, "mine1", "notes/20261101-untitled.md", note("Untitled", "mine"));
    const moves: [string, string][] = [];
    const r = run(s, server, { moved: (a, b) => moves.push([a, b]) });
    await r.go();
    expect(moves).toEqual([["notes/20261101-untitled.md", "notes/20261101-untitled-2.md"]]);
    await run(s, server).go();                                 // the next pull brings the server's own note down
    expect(s.notes.get("notes/20261101-untitled.md")!.text).toBe(note("Untitled", "theirs"));
    expect(s.notes.get("notes/20261101-untitled-2.md")).toMatchObject({ text: note("Untitled", "mine"), rev: 1 });
    expect([...server.notes.values()].map((x) => x.path).sort()).toEqual(["notes/20261101-untitled-2.md", "notes/20261101-untitled.md"]);
  });

  test("a create whose reply was lost, then edited, is read back by its record id: one note, never a second", async () => {
    const server = fakeServer(), s = store();
    addNote(s, "mine1", P, note("A", "one"));
    const create = server.api.notes.create;
    server.api.notes.create = async (rec, path, text, mark) => { await create(rec, path, text, mark); throw new Unavailable("reply lost"); };
    await run(s, server).go();
    expect(server.notes.get("mine1")).toMatchObject({ path: P, rev: 1 });
    expect(waiting(s)).toBe(1);
    writeNote(s, P, note("A", "one\ntwo"));                     // edited before the next round
    server.api.notes.create = create;
    await run(s, server).go();
    expect([...server.notes.values()].map((r) => [r.rec, r.path, r.text, r.rev])).toEqual([["mine1", P, note("A", "one\ntwo"), 2]]);
    expect(s.notes.get(P)).toMatchObject({ rec: "mine1", rev: 2, conflict_rev: null });
    expect(waiting(s)).toBe(0);
  });

  test("a note deleted and made again at the same path elsewhere is fetched again, not kept as the old one", async () => {
    const server = fakeServer(), s = store();
    const old = server.put(P, note("A", "old"));
    await run(s, server).go();
    server.notes.delete(old.rec);
    const now = server.put(P, note("A", "new"));                // a new record, at rev 1 like the old one was
    expect(now.rev).toBe(old.rev);
    await run(s, server).go();
    expect(s.notes.get(P)).toMatchObject({ rec: now.rec, rev: 1, text: note("A", "new"), base: note("A", "new") });
    expect(waiting(s)).toBe(0);
  });

  test("an edit to a note deleted and made again elsewhere moves aside, never merged into the new note", async () => {
    const server = fakeServer(), s = store();
    const old = server.put(P, note("A", "old"));
    await run(s, server).go();
    server.notes.delete(old.rec);
    const now = server.put(P, note("A", "new"));
    writeNote(s, P, note("A", "old, edited here"));
    await run(s, server).go();
    expect(server.notes.get(now.rec)!.text).toBe(note("A", "new"));
    const moved = [...server.notes.values()].find((r) => r.rec !== now.rec)!;
    expect([moved.path, moved.text]).toEqual(["notes/20261101-a-2.md", note("A", "old, edited here")]);
    await run(s, server).go();
    expect(s.notes.get(P)).toMatchObject({ rec: now.rec, text: note("A", "new") });
  });

  test("text kept after taking theirs outlives the server deleting the note, and restoring puts it back", async () => {
    const server = fakeServer(), s = store();
    const r = server.put(P, note("A", "one"));
    await run(s, server).go();
    writeNote(s, P, note("A", "mine"));
    server.put(P, note("A", "theirs"));
    await run(s, server).go();
    takeTheirs(s, P);
    server.notes.delete(r.rec);
    await run(s, server).go();
    expect(s.notes.get(P)).toMatchObject({ lost: note("A", "mine") });
    expect(conflicted(s)).toEqual([P]);
    restoreMine(s, P);
    await run(s, server).go();
    expect([...server.notes.values()].map((x) => [x.path, x.text])).toEqual([[P, note("A", "mine")]]);
  });

  test("a delete is a tombstone, sent with its rev; a note the server never had is gone at once", async () => {
    const server = fakeServer(), s = store();
    server.put(P, note("A", "one"));
    await run(s, server).go();
    addNote(s, "mine1", "notes/20261101-b.md", note("B"));
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
    addNote(s, "mine1", P, note("A", "one"));
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
    s.notes.put({ ...freshNote("r", P, note("A"), 1), rev: 1, base: note("A"), pushed: 1 });
    writeNote(s, P, note("A", "x"));
    expect(s.notes.get(P)!.updated).toBeGreaterThan(s.notes.get(P)!.pushed!);
  });

  test("a row's `updated` is the store's clock, and only moves forward when that clock is behind it", () => {
    const s = { ...store(), now: () => 5_000 };
    addNote(s, "r", P, note("A"));
    expect(s.notes.get(P)!.updated).toBe(5_000);
    s.notes.put({ ...s.notes.get(P)!, updated: 9_000 });
    writeNote(s, P, note("A", "x"));
    expect(s.notes.get(P)!.updated).toBe(9_001);
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

describe("refused", () => {
  const refusal = outcomeOf(400, { message: "Failed to create record.", data: { title: { code: "validation_max_text_constraint", message: "Must be no more than 500 character(s)." } } }, "tasks");

  test("a change the server refuses is parked with its reason, not counted as waiting nor sent again", async () => {
    const server = fakeServer(), s = store();
    saveTask(s, newTask("task1", { title: "x" }));
    let tries = 0;
    server.api.tasks.create = async () => { tries++; throw refusal; };
    const r = run(s, server);
    expect(await r.go()).toBe(true);
    expect(r.errs).toEqual([]);
    expect(waiting(s)).toBe(0);
    expect(refusals(s)).toEqual([{ kind: "task", key: "task1", title: "x", deleted: false, reason: "Failed to create record. (title: Must be no more than 500 character(s).)" }]);
    await run(s, server).go();
    expect(tries).toBe(1);
  });

  test("an edit or a retry sends it again; a discard lets it go", async () => {
    const server = fakeServer(), s = store();
    saveTask(s, newTask("task1", { title: "x" }));
    const create = server.api.tasks.create;
    server.api.tasks.create = async () => { throw refusal; };
    await run(s, server).go();
    saveTask(s, { ...s.tasks.get("task1")!.data, title: "shorter" });
    expect(refusals(s)).toEqual([]);
    await run(s, server).go();
    expect(refusals(s).length).toBe(1);
    expect(retryRefused(s, "task", "task1")).toBe(true);
    expect(retryRefused(s, "task", "task1")).toBe(false);
    server.api.tasks.create = create;
    await run(s, server).go();
    expect(server.tasks.get("task1")).toMatchObject({ title: "shorter", rev: 1 });
    server.api.tasks.update = async () => { throw refusal; };
    saveTask(s, { ...s.tasks.get("task1")!.data, title: "refused" });
    await run(s, server).go();
    expect(discardRefused(s, "task", "task1")).toBe(true);
    expect(s.tasks.get("task1")!.data.title).toBe("shorter");
    expect(waiting(s)).toBe(0);
  });

  test("a refused note goes back to the server's text when discarded, a never-sent one away", async () => {
    const server = fakeServer(), s = store();
    server.put(P, note("A", "one"));
    await run(s, server).go();
    server.api.notes.update = async () => { throw refusal; };
    server.api.notes.create = async () => { throw refusal; };
    writeNote(s, P, note("A", "too long"));
    addNote(s, "mine2", "notes/20261101-b.md", note("B"));
    await run(s, server).go();
    expect(refusals(s).map((x) => [x.kind, x.key, x.title])).toEqual([["note", P, "A"], ["note", "notes/20261101-b.md", "B"]]);
    discardRefused(s, "note", P);
    discardRefused(s, "note", "notes/20261101-b.md");
    expect(s.notes.get(P)!.text).toBe(note("A", "one"));
    expect(s.notes.get("notes/20261101-b.md")).toBeUndefined();
    expect(waiting(s)).toBe(0);
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

  test("a link to a note made here waits for the note to go up", async () => {
    const server = fakeServer(), s = store();
    server.putTask(newTask("task1", { title: "x" }));
    addNote(s, "mine1", P, note("A"));
    const id = addLink(s, ids(), { type: "task", id: "task1" }, { type: "note", id: "mine1" }, "about");
    server.api.notes.create = async () => { throw new Unavailable("down"); };
    await run(s, server).go();
    expect(s.links.get(id)).toMatchObject({ pushed: null });
    expect(server.links.size).toBe(0);
  });

  test("a link whose task is not up yet waits a round, not forever", async () => {
    const server = fakeServer(), s = store();
    const n = server.put(P, note("A"));
    saveTask(s, newTask("task1", { title: "x" }));
    const id = addLink(s, ids(), { type: "task", id: "task1" }, { type: "note", id: n.rec }, "about");
    s.tasks.put({ ...s.tasks.get("task1")!, rev: null });
    // a round in which the task's create fails: the link stays unsent, and is not dropped
    server.api.tasks.create = async () => { throw outcomeOf(500, { message: "Something went wrong." }, "tasks"); };
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

  test("a link to a note deleted elsewhere is dropped, not retried forever", async () => {
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

});

describe("waiting", () => {
  test("counts unsent and deleted rows, not those in step", () => {
    const s = store();
    expect(waiting(s)).toBe(0);
    s.notes.put({ ...freshNote("r", P, "x", 1), rev: 1, pushed: 1 });
    expect(waiting(s)).toBe(0);
    patch(s.notes, P, { updated: 5 });
    expect(waiting(s)).toBe(1);
  });
});

describe("the realtime feed, one record at a time", () => {
  const fetched = (r: NoteRec) => ({ rec: r.rec, path: r.path, rev: r.rev, text: r.text, kind: "note" as const });

  test("a note changed elsewhere is taken at a newer rev; its own rev or an older one (an echo of this push) changes nothing", async () => {
    const server = fakeServer(), s = store();
    const r1 = { ...server.put(P, note("A", "one")) };
    await run(s, server).go();
    expect(takeHeard(s, { topic: "notes", note: fetched(r1) })).toBe(false);
    const r2 = { ...server.put(P, note("A", "two")) };
    expect(takeHeard(s, { topic: "notes", note: fetched(r2) })).toBe(true);
    expect(s.notes.get(P)).toMatchObject({ text: note("A", "two"), rev: 2, base: note("A", "two") });
    expect(waiting(s)).toBe(0);
    expect(takeHeard(s, { topic: "notes", note: fetched(r1) })).toBe(false);
    expect(s.notes.get(P)!.text).toBe(note("A", "two"));
    writeNote(s, P, note("A", "mine"));
    await run(s, server).push();
    const echo = server.notes.get(r1.rec)!;
    expect(takeHeard(s, { topic: "notes", note: fetched(echo) })).toBe(false);
    expect(s.notes.get(P)).toMatchObject({ rev: echo.rev, text: note("A", "mine") });
  });

  test("a note edited here and not sent keeps its edit; the push merges the newer one in", async () => {
    const server = fakeServer(), s = store();
    server.put(P, note("A", "l1\nl2\nl3"));
    await run(s, server).go();
    writeNote(s, P, note("A", "l1\nl2\nl3 mine"));
    const theirs = server.put(P, note("A", "l1 theirs\nl2\nl3"));
    expect(takeHeard(s, { topic: "notes", note: fetched(theirs) })).toBe(false);
    expect(s.notes.get(P)!.text).toBe(note("A", "l1\nl2\nl3 mine"));
    await run(s, server).push();
    expect(server.notes.get(theirs.rec)!.text).toBe(note("A", "l1 theirs\nl2\nl3 mine"));
  });

  test("a note created elsewhere is added; one gone is dropped unless edited here, and a tombstone's delete is done", async () => {
    const server = fakeServer(), s = store();
    const a = server.put(P, note("A")), b = server.put("notes/20261101-b.md", note("B"));
    expect(takeHeard(s, { topic: "notes", note: fetched(a) })).toBe(true);
    expect(takeHeard(s, { topic: "notes", note: fetched(b) })).toBe(true);
    expect(takeHeard(s, { topic: "notes", note: { ...fetched(a), path: "memory/x.md" } })).toBe(false);   // not a note of the lists
    writeNote(s, "notes/20261101-b.md", note("B", "edited"));
    expect(takeHeard(s, { topic: "notes", gone: { rec: "another", path: P } })).toBe(false);
    expect(takeHeard(s, { topic: "notes", gone: { rec: a.rec, path: P } })).toBe(true);
    expect(takeHeard(s, { topic: "notes", gone: { rec: b.rec, path: "notes/20261101-b.md" } })).toBe(false);
    expect(s.notes.get(P)).toBeUndefined();
    expect(s.notes.get("notes/20261101-b.md")!.text).toBe(note("B", "edited"));
    s.notes.put({ ...s.notes.get("notes/20261101-b.md")!, deleted: true });
    expect(takeHeard(s, { topic: "notes", gone: { rec: b.rec, path: "notes/20261101-b.md" } })).toBe(true);
    expect(s.notes.all()).toEqual([]);
  });

  test("a task: a newer rev taken, the same ignored, an unsent edit kept, a delete taken unless edited here", async () => {
    const server = fakeServer(), s = store();
    server.putTask(newTask("t1", { title: "one" }));
    await run(s, server).go();
    expect(takeHeard(s, { topic: "tasks", task: { ...newTask("t1", { title: "one" }), rev: 1 } })).toBe(false);
    expect(takeHeard(s, { topic: "tasks", task: { ...newTask("t1", { title: "two" }), rev: 2 } })).toBe(true);
    expect(s.tasks.get("t1")).toMatchObject({ rev: 2, data: { title: "two" } });
    saveTask(s, { ...s.tasks.get("t1")!.data, title: "mine" });
    expect(takeHeard(s, { topic: "tasks", task: { ...newTask("t1", { title: "three" }), rev: 3 } })).toBe(false);
    expect(takeHeard(s, { topic: "tasks", gone: "t1" })).toBe(false);
    expect(s.tasks.get("t1")!.data.title).toBe("mine");
    expect(takeHeard(s, { topic: "tasks", task: { ...newTask("t2", { title: "new" }), rev: 1 } })).toBe(true);
    expect(takeHeard(s, { topic: "tasks", gone: "t2" })).toBe(true);
    expect(s.tasks.get("t2")).toBeUndefined();
  });

  test("a link: one made elsewhere is added, an add of ours that landed is marked sent, one gone is dropped", () => {
    const s = store();
    const theirs: Link = { id: "l1", from: { type: "task", id: "t1" }, to: { type: "note", id: "r1" }, role: "about" };
    expect(takeHeard(s, { topic: "links", link: theirs })).toBe(true);
    expect(takeHeard(s, { topic: "links", link: theirs })).toBe(false);
    const mine = addLink(s, "l2", { type: "task", id: "t2" }, { type: "note", id: "r1" }, "about");
    expect(takeHeard(s, { topic: "links", gone: mine })).toBe(false);          // not up yet: the push's to settle
    expect(takeHeard(s, { topic: "links", link: { ...theirs, id: mine, from: { type: "task", id: "t2" } } })).toBe(true);
    expect(s.links.get(mine)!.pushed).not.toBeNull();
    expect(takeHeard(s, { topic: "links", gone: "l1" })).toBe(true);
    expect(s.links.get("l1")).toBeUndefined();
  });

  test("a push alone lists nothing: it sends what was edited here", async () => {
    const server = fakeServer(), s = store();
    addNote(s, "r1", P, note("A"));
    saveTask(s, newTask("t1", { title: "x" }));
    expect(await run(s, server).push()).toBe(true);
    expect(server.calls).toEqual(["notes.create", "tasks.create"]);
    expect(waiting(s)).toBe(0);
    server.take(true);
    writeNote(s, P, note("A", "more"));
    saveTask(s, { ...s.tasks.get("t1")!.data, title: "y" });
    expect(await run(s, server).push()).toBe(false);              // the server out of reach ends it at the first failure
    expect(server.calls.slice(2)).toEqual(["notes.update"]);
  });
});
