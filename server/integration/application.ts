// Opt-in real HTTP coverage for application services and their companion adapters.
import { expect, test } from "bun:test";
import * as pb from "../../packages/core/src/pocketbase";
import { NoteService } from "../agent/src/application/notes";
import { TaskService, taskEdit } from "../agent/src/application/todo";
import { addTaskRoute, tickRoute } from "../agent/src/companion";
import { exists, saver } from "../agent/src/chats";
import { readChatHistory } from "../../packages/core/src/chat-history";

const url = process.env.TEF_CONTRACT_URL;
if (!url || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw new Error("Run integration/run.ts --application");
const server = { url };

test("chat saver writes versioned history over HTTP; the format guard refuses unreadable records", async () => {
  const created = await pb.call(server, "collections/chats/records", pb.json("POST", { title: "Old chat", messages: [] }));
  expect(await exists(server, created.id)).toBe(true);
  const messages = [{ id: "user-question", role: "user" as const, parts: [{ type: "text" as const, text: "A saved conversation" }] }];
  await saver(server, created.id, "test-model")(messages);
  const path = `collections/chats/records/${created.id}`;
  const saved = await pb.call(server, path);
  expect(saved).toMatchObject({ historyVersion: 1, title: "A saved conversation", model: "test-model" });
  expect(readChatHistory(saved)).toEqual(messages);
  await pb.call(server, path, pb.json("PATCH", { historyVersion: 2 }));
  await expect(exists(server, created.id)).rejects.toThrow("Unsupported chat history version");
  expect(await pb.call(server, path)).toMatchObject({ historyVersion: 2, messages });
});

test("application writes expose domain results and recurrence carries links over real PocketBase", async () => {
  const notes = new NoteService(server), tasks = new TaskService(server);
  const note = await notes.create("Application contract", () => "---\ntitle: Application contract\ncreated: 2026-11-15\n---\nOriginal\n", true);
  if ("error" in note) throw new Error(note.error);
  expect(note).not.toHaveProperty("card");
  const initial = await notes.meta(note.saved);
  expect(initial?.tainted).toBe(true);
  const changed = await notes.change(note.saved, (text) => text + "Appended\n");
  expect(changed).toMatchObject({ rev: 2, text: expect.stringContaining("Appended") });
  expect((await notes.meta(note.saved))?.rev).toBe(2);

  const added = await tasks.addTask({ title: "Repeat", when: "2026-11-15", every: "1d" }, [], true, [initial!.rec]);
  if ("error" in added) throw new Error(added.error);
  expect(added).not.toHaveProperty("card");
  expect(added.task?.title).toBe("Repeat");
  const edited = await tasks.editTask(added.id, taskEdit({ notes: "Shared application behavior" }));
  expect(edited).toMatchObject({ rev: 2, task: { notes: "Shared application behavior" } });
  const done = await tasks.completeTask(added.id, true, true);
  if ("error" in done) throw new Error(done.error);
  expect(done.next).toBeString();
  expect(await tasks.notesOf(done.next!)).toEqual([initial!.rec]);
  expect((await tasks.task(done.next!))?.notes).toBe("Shared application behavior");
  expect((await tasks.tainted()).has(done.next!)).toBe(true);
  expect(await tasks.completeTask(added.id, true)).toMatchObject({ unchanged: true });
  const after = await tasks.tasks();
  expect(after.filter((task) => task.title === "Repeat")).toHaveLength(2);
  await tasks.deleteTask(done.next!);
  expect(await tasks.task(done.next!)).toBeUndefined();
});

test("companion add and tick execute the application service against real PocketBase", async () => {
  const made = pb.recordId();
  const send = () => addTaskRoute(new Request(`${url}/agent/companion/tasks`, {
    method: "POST", body: JSON.stringify({ id: made, title: "From companion", list: "today" }),
    headers: { "Content-Type": "application/json" },
  }), server);
  const response = await send();
  expect(response.status).toBe(200);
  const { id } = await response.json() as { id: string };
  expect(id).toBe(made);
  expect((await send()).status).toBe(200);                                    // the same send again: the same task
  expect((await pb.tasks.list(server, { filter: `title = "From companion"` })).length).toBe(1);
  expect((await pb.tasks.get(server, id))?.title).toBe("From companion");
  expect((await tickRoute(server, id)).status).toBe(200);
  const completed = await pb.tasks.get(server, id);
  expect(completed?.done).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect((await tickRoute(server, id)).status).toBe(200);
  expect((await pb.tasks.get(server, id))?.rev).toBe(completed?.rev);
});
