import { describe, expect, it } from "bun:test";
import {
  addItem, complete, mergeRecord, newTask, nextOrder, normalizeTask, patchTask, removeItem, reopen, retagTask, setItem,
  taskOf, views, type Task,
} from "../src/todo";

// 2026-10-31 is a Saturday.
const T = "2026-10-31";
let n = 0;
const id = () => `id${String(++n).padStart(13, "0")}`;
const task = (title: string, p: Partial<Task> = {}) => newTask(id(), { title, ...p });

describe("making and patching", () => {
  it("a new task is open and unset, on one line", () => {
    expect(newTask("abc", { title: " Call\nplumber " })).toEqual({
      id: "abc", title: "Call plumber", notes: "", checklist: [], when: "", evening: false, due: "", every: "", remind: "", done: "", order: 0, tags: [], where: null,
    });
  });
  it("refuses what the server would", () => {
    expect(() => task("")).toThrow(/title/);
    expect(() => task("x", { when: "2026-02-30" })).toThrow(/when/);
    expect(() => task("x", { every: "often" })).toThrow(/every/);
    expect(() => task("x", { remind: "9:00" })).toThrow(/remind/);
    expect(() => patchTask(task("x"), { evening: true })).toThrow(/evening/);
  });
  it("evening needs a when", () => {
    expect(patchTask(task("x", { when: T, evening: true }), { when: "" })).toMatchObject({ when: "", evening: false });
    expect(normalizeTask({ ...task("x"), evening: true })).toMatchObject({ evening: false });
  });
  it("reads a server record, nulls and extra keys and all", () => {
    expect(taskOf({ id: "x", title: "t", checklist: null, collectionId: "c", order: 2, rev: 4 })).toMatchObject({ id: "x", checklist: [], order: 2 });
    expect(taskOf({ id: "x", title: "t", checklist: [{ done: 1, id: "a", text: "b" }] }).checklist).toEqual([{ id: "a", text: "b", done: true }]);
    expect(nextOrder([])).toBe(0);
    expect(nextOrder([{ order: 3 }, { order: 1 }])).toBe(4);
  });
});

describe("tags", () => {
  it("a patch sets them once each ignoring case and tonos, trimmed, without the #", () => {
    expect(patchTask(task("x"), { tags: [" #Home ", "home", "ΈΡΓΟ", "έργο", ""] }).tags).toEqual(["Home", "ΈΡΓΟ"]);
    expect(newTask("a", { title: "x", tags: ["a", "A"] }).tags).toEqual(["a"]);
  });
  it("refuses a name the server would", () => {
    expect(() => task("x", { tags: ["x".repeat(41)] })).toThrow(/tags/);
    expect(() => task("x", { tags: ["a,b"] })).toThrow(/tags/);
  });
  it("retagTask adds (a name it has stays) and removes ignoring case", () => {
    const t = task("x", { tags: ["Home", "Work"] });
    expect(retagTask(t, ["home", "Errand"], ["WORK"]).tags).toEqual(["Home", "Errand"]);
    expect(retagTask(t, [], []).tags).toEqual(["Home", "Work"]);
  });
  it("tags are read as names, each once, and a repeat's next round keeps them", () => {
    expect(taskOf({ id: "x", title: "t", tags: ["a", 3, null, "A"] })).toMatchObject({ tags: ["a"] });
    expect(taskOf({ id: "x", title: "t" })).toMatchObject({ tags: [] });
    const r = complete(task("x", { when: T, every: "1d", tags: ["a"] }), T, id);
    expect(r.next).toMatchObject({ tags: ["a"] });
  });
});

describe("where", () => {
  const MUSEUM = { name: "Acropolis Museum", address: "Dionysiou Areopagitou 15, Athens", lat: 37.9684, lng: 23.7285, place_id: "ChIJ8UNwBh-9oRQR3Y1mdkU1Nic" };
  it("is read off the wire defensively, and set and cleared by a patch", () => {
    expect(taskOf({ id: "a", title: "x", where: MUSEUM }).where).toEqual(MUSEUM);
    expect(taskOf({ id: "a", title: "x", where: { address: "no name" } }).where).toBeNull();
    expect(taskOf({ id: "a", title: "x" }).where).toBeNull();
    const t = patchTask(task("Dinner"), { where: MUSEUM });
    expect(t.where).toEqual(MUSEUM);
    expect(patchTask(t, { where: null }).where).toBeNull();
  });
  it("goes on with a repeating task's next round", () => {
    const { next } = complete(task("Swim", { every: "1w", when: "2026-11-02", where: { name: "Pool" } }), "2026-11-02", id);
    expect(next!.where).toEqual({ name: "Pool" });
  });
  it("merges as one value: theirs when only they moved it, mine when both did", () => {
    const base = task("Dinner"), mine = { ...base, title: "Dinner!" }, theirs = { ...base, where: MUSEUM };
    expect(mergeRecord(base, mine, theirs).merged.where).toEqual(MUSEUM);
    const r = mergeRecord(base, { ...base, where: { name: "Home" } }, theirs);
    expect(r.merged.where).toEqual({ name: "Home" });
    expect(r.conflicts).toEqual(["where"]);
  });
});

describe("ticking", () => {
  it("a plain task is done today; reopened, open again", () => {
    const r = complete(task("x"), T, id);
    expect(r).toEqual({ task: expect.objectContaining({ done: T }) });
    expect(reopen(r.task).done).toBe("");
    expect(complete(r.task, "2026-11-02", id).task.done).toBe(T);
  });
  it("a repeating one: the done copy loses every, the next round is a new record, checklist unticked, due moved with when", () => {
    const t = task("Call", { when: "2026-10-27", due: "2026-10-29", every: "1w", remind: "09:00", checklist: [{ id: "a", text: "n", done: true }] });
    const { task: done, next } = complete(t, T, () => "next");
    expect(done).toMatchObject({ id: t.id, done: T, every: "" });
    expect(next).toMatchObject({ id: "next", done: "", when: "2026-11-03", due: "2026-11-05", every: "1w", remind: "09:00", checklist: [{ id: "a", text: "n", done: false }] });
  });
  it("due only moves the due; nothing scheduled gets a when", () => {
    expect(complete(task("Rent", { due: "2026-11-01", every: "1m" }), T, id).next).toMatchObject({ due: "2026-12-01", when: "" });
    expect(complete(task("Gym", { every: "mon" }), T, id).next).toMatchObject({ when: "2026-11-02" });
    expect(complete(task("Water", { when: "2026-10-20", every: "+3d" }), T, id).next?.when).toBe("2026-11-03");
  });
});

describe("checklist", () => {
  it("adds, ticks, renames and removes items by id", () => {
    let t = addItem(addItem(task("x"), "one"), "two\nlines");
    const [a, b] = t.checklist;
    expect(a.id).not.toBe(b.id);
    expect(b.text).toBe("two lines");
    t = setItem(t, a.id, { done: true, text: "uno" });
    expect(t.checklist[0]).toEqual({ id: a.id, text: "uno", done: true });
    expect(removeItem(t, a.id).checklist).toEqual([b]);
    expect(setItem(t, "none", { done: true })).toEqual(t);
  });
});

describe("views", () => {
  it("sorts open tasks into Things' lists, each by order", () => {
    const ts = [
      task("inbox 2", { order: 2 }), task("inbox 1", { order: 1 }),
      task("today", { when: "2026-10-30" }), task("evening", { when: T, evening: true }), task("due", { due: T }),
      task("later b", { when: "2026-11-03", order: 2 }), task("later a", { when: "2026-11-03", order: 1 }), task("sooner", { when: "2026-11-01" }),
      task("old", { done: "2026-10-01" }), task("new", { done: "2026-10-30" }),
    ];
    const v = views(ts, T), titles = (l: Task[]) => l.map((t) => t.title);
    expect(titles(v.inbox)).toEqual(["due", "inbox 1", "inbox 2"]);   // order 0, 1, 2
    expect(titles(v.today)).toEqual(["today", "due"]);
    expect(titles(v.evening)).toEqual(["evening"]);
    expect(v.upcoming.map((d) => [d.day, titles(d.tasks)])).toEqual([["2026-11-01", ["sooner"]], ["2026-11-03", ["later a", "later b"]]]);
    expect(titles(v.logbook)).toEqual(["new", "old"]);
  });
});

describe("mergeRecord", () => {
  const base = task("Call", { when: "2026-11-03", checklist: [{ id: "a", text: "one", done: false }, { id: "b", text: "two", done: false }] });
  it("takes each side's changes to different fields", () => {
    const r = mergeRecord(base, { ...base, title: "Call plumber" }, { ...base, when: "2026-11-04" });
    expect(r).toEqual({ merged: { ...base, title: "Call plumber", when: "2026-11-04" }, conflicts: [] });
  });
  it("a field both changed differently: mine kept, named", () => {
    const r = mergeRecord(base, { ...base, title: "Mine", due: T }, { ...base, title: "Theirs", due: T });
    expect(r.merged).toMatchObject({ title: "Mine", due: T });
    expect(r.conflicts).toEqual(["title"]);
  });
  it("merges a checklist by item id, whatever the server's key order", () => {
    const theirs = { ...base, checklist: [{ done: true, id: "a", text: "one" }, { done: false, id: "b", text: "two" }, { done: false, id: "c", text: "three" }] };
    const mine = { ...base, checklist: [{ id: "z", text: "first", done: false }, { id: "a", text: "uno", done: false }] };   // b removed here
    const r = mergeRecord(base, mine, theirs);
    expect(r.merged.checklist).toEqual([{ id: "z", text: "first", done: false }, { id: "a", text: "uno", done: true }, { id: "c", text: "three", done: false }]);
    expect(r.conflicts).toEqual([]);
  });
  it("an item removed on one side and changed on the other stays, a conflict", () => {
    const r = mergeRecord(base, { ...base, checklist: [base.checklist[1]] }, { ...base, checklist: [{ ...base.checklist[0], done: true }, base.checklist[1]] });
    expect(r.merged.checklist.map((i) => i.id)).toEqual(["a", "b"]);
    expect(r.conflicts).toEqual(["checklist"]);
  });
  it("tags merge as a set: both sides' additions kept, a removal on either side goes, never a conflict", () => {
    const b = { ...base, tags: ["a", "b", "c"] };
    const r = mergeRecord(b, { ...b, tags: ["a", "c", "Mine"] }, { ...b, tags: ["A", "b", "c", "theirs"] });
    expect(r.merged.tags).toEqual(["a", "c", "Mine", "theirs"]);
    expect(r.conflicts).toEqual([]);
  });
  it("no base: tags are a union, everything else a conflict", () => {
    const r = mergeRecord(null, { ...base, tags: ["a"] }, { ...base, tags: ["b"] });
    expect(r.merged.tags).toEqual(["a", "b"]);
    expect(r.conflicts).toEqual([]);
  });
  it("no base: every difference is a conflict, mine kept", () => {
    const r = mergeRecord(null, { ...base, title: "Mine" }, { ...base, title: "Theirs", notes: "n" });
    expect(r.merged).toMatchObject({ title: "Mine", notes: "" });
    expect(r.conflicts.sort()).toEqual(["notes", "title"]);
  });
});
