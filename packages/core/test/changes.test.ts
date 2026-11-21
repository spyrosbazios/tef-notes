// A change as data (src/changes.ts): applied to a copy as the edit helpers of src/sync.ts would, and a tick worked out as changes.
import { describe, expect, test } from "bun:test";
import { applyChange, keysOf, tickChanges, topicOf, type Change } from "../src/changes";
import { liveLinks, visibleLinks, type LinkRow, type NoteRow, type Store, type TaskRow } from "../src/sync";
import { newTask } from "../src/todo";

const table = <R>(key: (r: R) => string) => {
  const m = new Map<string, R>();
  return { get: (k: string) => m.get(k), all: () => [...m.values()], put: (r: R) => void m.set(key(r), r), delete: (k: string) => void m.delete(k) };
};
const store = (): Store => ({ notes: table<NoteRow>((r) => r.path), tasks: table<TaskRow>((r) => r.id), links: table<LinkRow>((r) => r.link.id) });
const P = "notes/20261101-a.md";

describe("applying a change", () => {
  test("says whether it changed the copy", () => {
    const s = store();
    expect(applyChange(s, { kind: "note.add", rec: "r1", path: P, text: "a" }, false)).toBe(true);
    expect(applyChange(s, { kind: "note.write", rec: "r1", path: P, text: "a" }, false)).toBe(false);
    expect(applyChange(s, { kind: "note.write", rec: "r1", path: P, text: "b", mark: { tainted: true } }, false)).toBe(true);
    expect(s.notes.get(P)).toMatchObject({ text: "b", tainted: true });
    const t = newTask("t1", { title: "x" });
    expect(applyChange(s, { kind: "task.save", task: t }, false)).toBe(true);
    expect(applyChange(s, { kind: "task.save", task: t }, false)).toBe(false);
    const link: Change = { kind: "link.add", id: "l1", from: { type: "task", id: "t1" }, to: { type: "note", id: "r1" }, role: "about" };
    expect(applyChange(s, link, false)).toBe(true);
    expect(applyChange(s, { ...link, id: "l2" }, false)).toBe(false);          // the relation is held already, under l1
    expect(applyChange(s, { kind: "link.remove", id: "l1" }, false)).toBe(true);
    expect(applyChange(s, { kind: "link.remove", id: "l1" }, false)).toBe(false);
  });

  test("a note's write finds it by record id where it moved, and puts it back when the copy no longer holds it", () => {
    const s = store();
    applyChange(s, { kind: "note.add", rec: "r1", path: P, text: "a" }, false);
    const moved = "notes/20261101-a-2.md";
    s.notes.put({ ...s.notes.get(P)!, path: moved });
    s.notes.delete(P);
    expect(applyChange(s, { kind: "note.write", rec: "r1", path: P, text: "b" }, false)).toBe(true);
    expect([s.notes.get(P), s.notes.get(moved)?.text]).toEqual([undefined, "b"]);
    s.notes.delete(moved);                                            // deleted on another device, the sync took it away
    expect(applyChange(s, { kind: "note.write", rec: "r1", path: moved, text: "c" }, false)).toBe(true);
    expect(s.notes.get(moved)).toMatchObject({ rec: "r1", text: "c", rev: null });
    applyChange(s, { kind: "note.add", rec: "r2", path: P, text: "another" }, false);
    s.notes.delete(moved);
    expect(() => applyChange(s, { kind: "note.write", rec: "r1", path: P, text: "d" }, false)).toThrow("taken");
  });

  test("a change names the row it is to", () => {
    expect(keysOf({ kind: "note.write", rec: "r1", path: P, text: "" })).toEqual(["notes", P]);
    expect(keysOf({ kind: "task.remove", id: "t1" })).toEqual(["tasks", "t1"]);
    expect(keysOf({ kind: "link.add", id: "l1", from: { type: "task", id: "t1" }, to: { type: "note", id: "r1" }, role: "about" })).toEqual(["links", "l1"]);
  });

  test("a delete of what the server never had keeps a tombstone only while a sync is out", () => {
    const s = store();
    applyChange(s, { kind: "note.add", rec: "r1", path: P, text: "a" }, false);
    applyChange(s, { kind: "task.save", task: newTask("t1", { title: "x" }) }, false);
    expect(applyChange(s, { kind: "note.remove", path: P }, true)).toBe(true);
    expect(s.notes.get(P)?.deleted).toBe(true);
    expect(applyChange(s, { kind: "task.remove", id: "t1" }, false)).toBe(true);
    expect(s.tasks.get("t1")).toBeUndefined();
  });

  test("names the list it is to", () => {
    expect(topicOf({ kind: "note.remove", path: P })).toBe("notes");
    expect(topicOf({ kind: "task.remove", id: "t" })).toBe("tasks");
    expect(topicOf({ kind: "link.remove", id: "l" })).toBe("links");
  });
});

describe("a tick", () => {
  test("of a repeating task: done as it is, the next round last of the open ones and about what the done one was about", () => {
    const s = store();
    const cur = newTask("task1", { title: "Pay rent", when: "2026-10-01", every: "1m", order: 5 });
    for (const task of [cur, newTask("task0", { title: "open", order: 2 })]) applyChange(s, { kind: "task.save", task }, false);
    applyChange(s, { kind: "link.add", id: "l1", from: { type: "task", id: "task1" }, to: { type: "note", id: "n1" }, role: "about" }, false);
    let i = 0;
    const changes = tickChanges(cur, true, { today: "2026-10-01", newId: () => `new${++i}`, open: [cur, newTask("task0", { title: "open", order: 2 })], links: liveLinks(s) });
    expect(changes.map((c) => c.kind)).toEqual(["task.save", "task.save", "link.add"]);
    for (const c of changes) applyChange(s, c, false);
    expect(s.tasks.get("task1")!.data).toMatchObject({ done: "2026-10-01", every: "" });
    expect(s.tasks.get("new1")!.data).toMatchObject({ every: "1m", done: "", when: "2026-11-01", order: 3 });
    expect(visibleLinks(s).map((l) => [l.id, l.from.id])).toEqual([["l1", "task1"], ["new2", "new1"]]);
  });

  test("of a task that doesn't repeat, or an untick, is the one save", () => {
    const cur = newTask("t", { title: "Once" });
    const o = { today: "2026-10-01", newId: () => "x", open: [cur], links: [] };
    expect(tickChanges(cur, true, o)).toEqual([{ kind: "task.save", task: { ...cur, done: "2026-10-01" } }]);
    expect(tickChanges({ ...cur, done: "2026-10-01" }, false, o)).toEqual([{ kind: "task.save", task: cur }]);
  });
});
