// Exercise application operations without assistant adapters or tool execution.
import { afterAll, beforeEach, expect, it } from "bun:test";
import { NoteService } from "../src/application/notes";
import { TaskService, taskEdit } from "../src/application/todo";
import { fakePb } from "./fake-pb";

const pb = fakePb(), server = { url: pb.url };
afterAll(() => pb.stop());
beforeEach(() => {
  pb.notes.clear(); pb.tasks.clear(); pb.links.clear(); pb.created.length = 0; pb.meanwhile();
});
const file = (body: string) => `---\ntitle: Test\ncreated: 2026-10-01\n---\n${body}`;
const path = "notes/test.md";

it("note append retries against fresh text, marks taint, and invalidates the request listing", async () => {
  pb.put(path, file("one\n"));
  const notes = new NoteService(server), initial = await notes.all();
  expect(await notes.all()).toBe(initial);
  pb.meanwhile((rec) => { pb.meanwhile(); rec.text = file("one\ntwo\n"); rec.rev++; });
  const result = await notes.change(path, (text) => text + "three\n", { taint: true });
  expect(result).toEqual({ saved: path, rev: 3, text: file("one\ntwo\nthree\n") });
  expect((await notes.meta(path))?.tainted).toBe(true);
  expect(await notes.all()).not.toBe(initial);
});

it("whole-note edits merge disjoint changes and refuse overlap without writing", async () => {
  pb.put(path, file("one\ntwo\nthree\n"));
  const notes = new NoteService(server), read = { rev: 1, text: file("one\ntwo\nthree\n") };
  pb.meanwhile((rec) => { pb.meanwhile(); rec.text = file("one\ntwo\nthree\nfour\n"); rec.rev++; });
  expect(await notes.change(path, (text) => text.replace("one", "ONE"), { base: read })).toEqual({
    saved: path, rev: 3, text: file("ONE\ntwo\nthree\nfour\n"),
  });
  pb.meanwhile((rec) => { pb.meanwhile(); rec.text = file("other\ntwo\nthree\nfour\n"); rec.rev++; });
  expect(await notes.change(path, (text) => text.replace("ONE", "mine"), { base: { rev: 3, text: file("ONE\ntwo\nthree\nfour\n") } })).toEqual({ error: expect.stringContaining("changed meanwhile") });
  expect(pb.notes.get(path)?.rev).toBe(4);
  expect(pb.notes.get(path)?.text).toContain("other");
});

it("a whole-note edit made over the text the writer read keeps what was typed since, however long ago", async () => {
  pb.put(path, file("one\ntwo\nthree\n"));
  const notes = new NoteService(server), read = { rev: 1, text: file("one\ntwo\nthree\n") };
  const rec = pb.notes.get(path)!;
  rec.text = file("one\ntwo\nthree\ntyped while the card waited\n"); rec.rev = 2;
  expect(await notes.change(path, (text) => text.replace("one", "ONE"), { base: read })).toEqual({
    saved: path, rev: 3, text: file("ONE\ntwo\nthree\ntyped while the card waited\n"),
  });
});

it("a whole-note edit over a file that moved, with no base text to merge from, is refused unwritten", async () => {
  pb.put(path, file("one\n"));
  const notes = new NoteService(server), rec = pb.notes.get(path)!;
  rec.text = file("typed\n"); rec.rev = 2;
  expect(await notes.change(path, () => file("mine\n"), { base: { rev: 1, text: null } })).toEqual({ error: expect.stringContaining("changed since you read it") });
  expect(pb.notes.get(path)).toMatchObject({ rev: 2, text: file("typed\n") });
});

it("note creation and memory writes return saved text without presentation", async () => {
  const notes = new NoteService(server);
  const result = await notes.create("Test", () => file("body\n"), true);
  expect(result).toMatchObject({ rev: 1, text: file("body\n") });
  expect(result).not.toHaveProperty("card");
  expect(await notes.change("agent/memory.md", () => "memory", { base: { rev: 0, text: null }, create: true })).toEqual({ saved: "agent/memory.md", rev: 1, text: "memory" });
});

it("task retries preserve concurrent checklist edits and taint, then release cached reads", async () => {
  const tasks = new TaskService(server);
  const added = await tasks.addTask({ title: "Shopping" }, ["Milk"]);
  if ("error" in added) throw new Error(added.error);
  const initial = await tasks.tasks();
  expect(await tasks.tasks()).toBe(initial);
  pb.meanwhile((rec) => { pb.meanwhile(); rec.checklist[0].done = true; rec.rev++; });
  const result = await tasks.editTask(added.id, taskEdit({ title: "Groceries" }), true);
  expect(result).toMatchObject({ saved: "task", rev: 3, task: { title: "Groceries", checklist: [{ text: "Milk", done: true }] } });
  expect(result).not.toHaveProperty("card");
  expect(pb.tasks.get(added.id)?.tainted).toBe(true);
  expect(await tasks.tasks()).not.toBe(initial);
});

it("a retried repeating tick makes one next round and carries its links and taint", async () => {
  const note = pb.put(path, file("body\n")), tasks = new TaskService(server);
  const added = await tasks.addTask({ title: "Repeat", when: "2026-10-01", every: "1d" }, [], false, [note.id]);
  if ("error" in added) throw new Error(added.error);
  pb.meanwhile((rec) => { pb.meanwhile(); rec.notes = "concurrent"; rec.rev++; });
  const result = await tasks.completeTask(added.id, true, true);
  if ("error" in result) throw new Error(result.error);
  expect(result.next).toBeString();
  expect(pb.tasks.size).toBe(2);
  expect(pb.tasks.get(result.next!)?.notes).toBe("concurrent");
  expect(pb.tasks.get(result.next!)?.tainted).toBe(true);
  expect(await tasks.notesOf(result.next!)).toEqual([note.id]);
  expect(await tasks.completeTask(added.id, true)).toMatchObject({ unchanged: true });
  expect(pb.tasks.size).toBe(2);
});

it("batch writes return records in order and relinking invalidates link reads", async () => {
  const tasks = new TaskService(server), note = pb.put(path, file("body\n"));
  const result = await tasks.addTasks([{ fields: { title: "First" }, checklist: [] }, { fields: { title: "Second" }, checklist: [] }]);
  if ("error" in result) throw new Error(result.error);
  expect(result.tasks.map((t) => t.title)).toEqual(["First", "Second"]);
  expect(result).not.toHaveProperty("cards");
  const id = result.ids[0];
  expect(await tasks.notesOf(id)).toEqual([]);
  expect(await tasks.editTask(id, (t) => t, false, [note.id])).not.toHaveProperty("unchanged");
  expect(await tasks.notesOf(id)).toEqual([note.id]);
  await tasks.editTask(id, (t) => t, false, [], [note.id]);
  expect(await tasks.notesOf(id)).toEqual([]);
  await tasks.deleteTask(id);
  expect(await tasks.task(id)).toBeUndefined();
});

it("bounds conflict retries without overwriting continuously changing records", async () => {
  pb.put(path, file("original\n"));
  let attempts = 0;
  pb.meanwhile((rec) => { attempts++; rec.rev++; rec.text = file(`other ${attempts}\n`); });
  const result = await new NoteService(server).change(path, (text) => text + "mine\n");
  expect(result).toEqual({ error: expect.stringContaining("keeps changing") });
  expect(attempts).toBe(3);
  expect(pb.notes.get(path)?.text).toBe(file("other 3\n"));
});

it("reports partial task creation when linking fails, retaining the successful record", async () => {
  const tasks = new TaskService(server);
  const result = await tasks.addTask({ title: "Still created" }, [], false, ["missingnote"]);
  expect(result).toEqual({ error: expect.stringContaining("wasn't linked") });
  expect((await tasks.tasks()).map((t) => t.title)).toEqual(["Still created"]);
  expect(await tasks.links()).toEqual([]);
});
