// The notes and tasks hooks' writes against a fake server that holds the rev contract: an edit goes out as the
// fields it changed, a stale one is redone on the newer record, and the realtime feed never puts an older copy over a newer.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import "./storage";
import { QueryClient } from "@tanstack/react-query";
import { parseNote } from "@/core/notes";
import { Conflict } from "@/core/pocketbase";
import { sameEnd, type Link, type LinkEnd } from "@/core/record-links";
import { retagTask, taskOf } from "@/core/todo";

type Rec = { id: string; rev: number; [k: string]: unknown };
const db = { tasks: new Map<string, Rec>() };
const sent: Record<string, unknown>[] = [];

function fake(map: Map<string, Rec>, of: (r: any) => { id: string }) {
  const rec = (r: Rec) => ({ ...of(r), rev: r.rev });
  return {
    rec,
    all: async () => [...map.values()].map(rec),
    get: async (id: string) => (map.has(id) ? rec(map.get(id)!) : null),
    create: async (r: { id: string }) => { if (map.has(r.id)) throw new Conflict("id"); const n = { ...r, rev: 1 }; map.set(r.id, n); return rec(n); },
    update: async (id: string, rev: number, fields: Record<string, unknown>) => {
      const cur = map.get(id);
      if (!cur) return null;
      sent.push(fields);
      if (cur.rev !== rev) throw new Conflict("rev");
      const n = { ...cur, ...fields, rev: cur.rev + 1 };
      map.set(id, n);
      return rec(n);
    },
    remove: async (id: string, rev: number) => { if (map.get(id)?.rev !== rev) throw new Conflict("rev"); map.delete(id); },
  };
}
mock.module("@/services/todo", () => ({ tasks: fake(db.tasks, taskOf) }));
const madeNotes: { path: string; text: string }[] = [];
mock.module("@/services/notes", () => ({
  create: async (path: string, text: string) => { madeNotes.push({ path, text }); return { rec: "r", path, rev: 1, kind: "note", text, updated: "" }; },
  withNote: (r: { path: string; text: string }) => ({ ...r, note: parseNote(r.path, r.text) }),
}));

// Links: a set by id, as the server holds them (no rev).
const linkDb = new Map<string, Link>();
mock.module("@/services/links", () => ({
  all: async () => [...linkDb.values()],
  from: async (end: LinkEnd) => [...linkDb.values()].filter((l) => sameEnd(l.from, end)),
  add: async (l: Link) => { linkDb.set(l.id, l); return l; },
  remove: async (id: string) => { linkDb.delete(id); },
}));

const { createNote } = await import("@/hooks/notes");
const { addTask, applyTask, editTask, changeTask, tickTask, TASKS } = await import("@/hooks/todo");
const { addItem } = await import("@/core/todo");
const { LENSES, setActiveLens } = await import("@/hooks/lens");

let qc: QueryClient;
beforeEach(() => { db.tasks.clear(); linkDb.clear(); sent.length = 0; madeNotes.length = 0; qc = new QueryClient(); setActiveLens(null); });
const cached = (id: string) => qc.getQueryData<{ id: string; rev: number; [k: string]: any }[]>(TASKS)?.find((t) => t.id === id);

describe("writes", () => {
  test("a new task goes in at rev 1 and into the cache", async () => {
    const t = await addTask(qc, { title: "  Call plumber ", when: "2026-11-03" });
    expect(t.rev).toBe(1);
    expect(cached(t.id)?.title).toBe("Call plumber");
    expect(db.tasks.get(t.id)?.when).toBe("2026-11-03");
  });

  test("under a lens a new task carries its first tag, once", async () => {
    qc.setQueryData(LENSES, [{ rec: "w", name: "Work", tags: ["work", "clients"], exclude: [], accent: null }]);
    setActiveLens("w");
    expect((await addTask(qc, { title: "a" })).tags).toEqual(["work"]);
    expect((await addTask(qc, { title: "b", tags: ["Work", "home"] })).tags).toEqual(["Work", "home"]);
    setActiveLens("gone");                                   // a lens deleted elsewhere is no lens
    expect((await addTask(qc, { title: "c" })).tags).toEqual([]);
    setActiveLens(null);
    expect((await addTask(qc, { title: "d" })).tags).toEqual([]);
  });

  test("under a lens a new note carries its first tag; under none or a deleted one, none", async () => {
    const tagsOfMade = () => parseNote(madeNotes.at(-1)!.path, madeNotes.at(-1)!.text).tags;
    qc.setQueryData(LENSES, [{ rec: "w", name: "Work", tags: ["work", "clients"], exclude: [], accent: null }]);
    await createNote(qc, "Plan");
    expect(tagsOfMade()).toEqual([]);
    setActiveLens("w");
    await createNote(qc, "Quarterly plan");
    expect(tagsOfMade()).toEqual(["work"]);
    setActiveLens("gone");
    await createNote(qc, "Another plan");
    expect(tagsOfMade()).toEqual([]);
  });

  test("an edit sends only the fields it changed", async () => {
    const t = await addTask(qc, { title: "a" });
    await editTask(qc, t.id, { due: "2026-11-10" });
    expect(sent.at(-1)).toEqual({ due: "2026-11-10" });
    expect(cached(t.id)?.rev).toBe(2);
  });

  test("an edit that changes nothing sends nothing", async () => {
    const t = await addTask(qc, { title: "a" });
    await editTask(qc, t.id, { title: "a" });
    expect(sent.length).toBe(0);
  });

  test("a stale rev is redone on the newer record, keeping the other side's change", async () => {
    const t = await addTask(qc, { title: "a" });
    db.tasks.set(t.id, { ...db.tasks.get(t.id)!, notes: "from the phone", rev: 2 });          // another device wrote
    await editTask(qc, t.id, { due: "2026-11-10" });
    expect(db.tasks.get(t.id)).toMatchObject({ due: "2026-11-10", notes: "from the phone", rev: 3 });
    expect(cached(t.id)?.notes).toBe("from the phone");
  });

  test("a checklist item added meanwhile survives an item added here", async () => {
    const t = await addTask(qc, { title: "a" });
    const theirs = addItem({ ...taskOf(db.tasks.get(t.id)) }, "theirs");
    db.tasks.set(t.id, { ...db.tasks.get(t.id)!, checklist: theirs.checklist, rev: 2 });
    await changeTask(qc, t.id, (cur) => addItem(cur, "mine"));
    expect((db.tasks.get(t.id)!.checklist as { text: string }[]).map((i) => i.text)).toEqual(["theirs", "mine"]);
  });

  test("a tag added here is redone on the record with the tag another device added", async () => {
    const t = await addTask(qc, { title: "a", tags: ["home"] });
    db.tasks.set(t.id, { ...db.tasks.get(t.id)!, tags: ["home", "errand"], rev: 2 });
    await changeTask(qc, t.id, (cur) => retagTask(cur, ["Urgent"]));
    expect(db.tasks.get(t.id)).toMatchObject({ tags: ["home", "errand", "Urgent"], rev: 3 });
    expect(sent.at(-1)).toEqual({ tags: ["home", "errand", "Urgent"] });
  });

  test("a tag is taken off ignoring case, and one it already has is not added twice", async () => {
    const t = await addTask(qc, { title: "a", tags: ["Home", "work"] });
    await changeTask(qc, t.id, (cur) => retagTask(cur, ["WORK"], ["home"]));
    expect(cached(t.id)?.tags).toEqual(["work"]);
    expect(sent.at(-1)).toEqual({ tags: ["work"] });
  });

  test("a value the server would refuse stops the edit before it is sent", async () => {
    const t = await addTask(qc, { title: "a" });
    await expect(editTask(qc, t.id, { when: "soon" })).rejects.toThrow();
    expect(sent.length).toBe(0);
  });

  test("a task deleted elsewhere is said so", async () => {
    const t = await addTask(qc, { title: "a" });
    db.tasks.delete(t.id);
    await expect(editTask(qc, t.id, { notes: "x" })).rejects.toThrow(/deleted/);
    expect(cached(t.id)).toBeUndefined();
  });
});

describe("ticking", () => {
  test("a task is done today", async () => {
    const t = await addTask(qc, { title: "a" });
    await tickTask(qc, t.id, true);
    expect(db.tasks.get(t.id)?.done).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await tickTask(qc, t.id, false);
    expect(db.tasks.get(t.id)?.done).toBe("");
  });

  test("a repeating task is done without `every`, and its next round is a new record", async () => {
    const t = await addTask(qc, { title: "Water plants", when: "2026-10-01", every: "1w" });
    await tickTask(qc, t.id, true);
    const all = [...db.tasks.values()];
    expect(all.length).toBe(2);
    const done = db.tasks.get(t.id)!, next = all.find((r) => r.id !== t.id)!;
    expect(done.every).toBe("");
    expect(next).toMatchObject({ every: "1w", done: "", title: "Water plants" });
    expect(String(next.when) > "2026-10-01").toBe(true);
  });

  test("the next round is about the same notes: its links made again from it, under new ids", async () => {
    const t = await addTask(qc, { title: "Pay rent", when: "2026-10-01", every: "1m" });
    linkDb.set("l1", { id: "l1", from: { type: "task", id: t.id }, to: { type: "note", id: "n1" }, role: "about" });
    linkDb.set("l2", { id: "l2", from: { type: "task", id: "other" }, to: { type: "note", id: "n2" }, role: "about" });
    await tickTask(qc, t.id, true);
    const next = [...db.tasks.values()].find((r) => r.id !== t.id)!;
    const carried = [...linkDb.values()].filter((l) => l.from.id === next.id);
    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({ to: { type: "note", id: "n1" }, role: "about" });
    expect(carried[0].id).not.toBe("l1");
    expect(linkDb.has("l1")).toBe(true);
  });

  test("ticking a task that doesn't repeat makes no links", async () => {
    const t = await addTask(qc, { title: "Once" });
    linkDb.set("l1", { id: "l1", from: { type: "task", id: t.id }, to: { type: "note", id: "n1" }, role: "about" });
    await tickTask(qc, t.id, true);
    expect(linkDb.size).toBe(1);
  });
});

describe("realtime", () => {
  test("a newer copy replaces the cached one; an older or equal one does not", async () => {
    const t = await addTask(qc, { title: "a" });
    const rec = (title: string, rev: number) => ({ action: "update" as const, record: { id: t.id, rev, title } });
    applyTask(qc, rec("newer", 5));
    expect(cached(t.id)).toMatchObject({ title: "newer", rev: 5 });
    applyTask(qc, rec("older", 3));
    applyTask(qc, rec("same", 5));
    expect(cached(t.id)?.title).toBe("newer");
    applyTask(qc, { action: "delete", record: { id: t.id, rev: 6 } });
    expect(cached(t.id)).toBeUndefined();
  });

  test("a feed before the first fetch is left for that fetch", () => {
    const fresh = new QueryClient();
    applyTask(fresh, { action: "create", record: { id: "x", rev: 1, title: "a" } });
    expect(fresh.getQueryData(TASKS)).toBeUndefined();
  });
});
