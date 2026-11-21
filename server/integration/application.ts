// Opt-in real HTTP coverage for application services and their companion adapters.
import { expect, test } from "bun:test";
import * as pb from "../../packages/core/src/pocketbase";
import { NoteService } from "../agent/src/application/notes";
import { TaskService, taskEdit } from "../agent/src/application/todo";
import { addTaskRoute, tickRoute } from "../agent/src/companion";
import { load, saver } from "../agent/src/chats";
import { fileBytes, storeFiles } from "../agent/src/chat-files";
import { readChatHistory } from "../../packages/core/src/chat-history";

const url = process.env.TEF_CONTRACT_URL;
if (!url || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw new Error("Run integration/run.ts --application");
const server = { url };

test("chat saver writes versioned history over HTTP at the rev it read; the format guard refuses unreadable records", async () => {
  const created = await pb.call(server, "collections/chats/records", pb.json("POST", { title: "Old chat", messages: [] }));
  expect(created.rev).toBe(1);
  const read = await load(server, created.id);
  expect(read).toEqual({ rev: 1, messages: [] });
  const messages = [{ id: "user-question", role: "user" as const, parts: [{ type: "text" as const, text: "A saved conversation" }] }];
  const save = saver(server, created.id, read!.rev, "test-model");
  await save(messages);
  await save([...messages, { id: "reply", role: "assistant" as const, parts: [{ type: "text" as const, text: "Saved twice" }] }]);
  const path = `collections/chats/records/${created.id}`;
  const saved = await pb.call(server, path);
  expect(saved).toMatchObject({ rev: 3, historyVersion: 1, title: "A saved conversation", model: "test-model" });
  expect(readChatHistory(saved)).toHaveLength(2);
  // another writer at the rev this saver last saw is refused: the chat's saves never undo each other
  await expect(saver(server, created.id, 2, "x")(messages)).rejects.toThrow("This chat wasn't saved");
  expect(await load(server, created.id)).toMatchObject({ rev: 3 });
  await pb.call(server, path, pb.json("PATCH", { historyVersion: 2, rev: 3 }));
  await expect(load(server, created.id)).rejects.toThrow("Unsupported chat history version");
});

test("a chat's attached file is stored on its own record, served back, and deleted with the chat", async () => {
  const created = await pb.call(server, "collections/chats/records", pb.json("POST", { title: "Files", messages: [] }));
  const bytes = new Uint8Array(8 * 1024 * 1024 - 4096).fill(0x20);
  bytes.set(new TextEncoder().encode("%PDF-1.4\n"));
  const url = `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`;
  const m = await storeFiles(server, created.id, { id: "u", role: "user", parts: [{ type: "file", mediaType: "application/pdf", filename: "big.pdf", url }] });
  const stored = (m.parts[0] as { url: string }).url;
  expect(stored).toMatch(/^\/api\/files\/chat_files\//);
  expect((await fileBytes(server, stored)).length).toBe(bytes.length);
  await pb.call(server, `collections/chats/records/${created.id}`, { method: "DELETE" });
  await expect(fileBytes(server, stored)).rejects.toThrow("HTTP 404");
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
  const request = new Request(`${url}/agent/companion/tasks`, {
    method: "POST", body: JSON.stringify({ title: "From companion", list: "today" }),
    headers: { "Content-Type": "application/json" },
  });
  const response = await addTaskRoute(request, server);
  expect(response.status).toBe(200);
  const { id } = await response.json() as { id: string };
  expect((await pb.tasks.get(server, id))?.title).toBe("From companion");
  expect((await tickRoute(server, id)).status).toBe(200);
  const completed = await pb.tasks.get(server, id);
  expect(completed?.done).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect((await tickRoute(server, id)).status).toBe(200);
  expect((await pb.tasks.get(server, id))?.rev).toBe(completed?.rev);
});
