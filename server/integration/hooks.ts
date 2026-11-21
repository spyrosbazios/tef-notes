// The server's own writers (pb_hooks over lib/records.js) against a real PocketBase: each keeps the rev contract a
// client's write is held to, and a client's next write over what they wrote meets it.
import { expect, test } from "bun:test";
import * as pb from "../../packages/core/src/pocketbase";
import { newTask } from "../../packages/core/src/todo";

const url = process.env.TEF_CONTRACT_URL;
if (!url || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw new Error("Run bun --no-env-file server/integration/run.ts");
const s = { url };
let serial = 0;
const id = () => `hooks${String(++serial).padStart(10, "0")}`;
const record = (collection: string, rec: string) => pb.call(s, `collections/${collection}/records/${rec}`);

/** The clip route's save, as the extension sends it: a multipart `@jsonPayload`, no files. */
async function clip(payload: Record<string, unknown>) {
  const form = new FormData();
  form.append("@jsonPayload", JSON.stringify({ title: "Clipped page", selection: "Words from the page", ...payload }));
  const res = await fetch(`${url}/api/tefnotes/clip`, { method: "POST", body: form });
  expect(res.status).toBe(200);
  return res.json() as Promise<Record<string, any>>;
}

test("clip: a new note starts at rev 1 with its columns copied out of its text", async () => {
  const out = await clip({ target: { kind: "new" }, tags: ["clipped"] });
  expect(out).toMatchObject({ kind: "note", action: "created" });
  const n = await pb.read(s, out.path);
  const rec = await record("notes", n!.rec);
  expect(rec).toMatchObject({ ...pb.noteColumns(out.path, rec.text), rev: 1, kind: "note", tags: ["clipped"] });
  expect(rec.text).toContain("Words from the page");
});

test("clip: an append to a note bumps rev and copies its columns; the client's stale write is refused", async () => {
  const n = await pb.create(s, `notes/${id()}.md`, '---\ntitle: "Target"\ntags: [a]\n---\nFirst\n');
  const out = await clip({ target: { kind: "note", path: n.path }, tags: ["b"] });
  expect(out).toMatchObject({ kind: "note", path: n.path, title: "Target", action: "appended" });
  const rec = await record("notes", n.rec);
  expect(rec).toMatchObject({ ...pb.noteColumns(n.path, rec.text), rev: 2, tags: ["a", "b"] });
  expect(rec.text).toContain("Words from the page");
  await expect(pb.update(s, n, "# Mine\n")).rejects.toBeInstanceOf(pb.Conflict);
  expect((await pb.update(s, { ...n, rev: 2 }, "# Mine\n"))?.rev).toBe(3);
});

test("clip: an append to a task bumps rev; a new task starts at rev 1", async () => {
  const t = await pb.tasks.create(s, newTask(id(), { title: "Existing" }));
  const out = await clip({ target: { kind: "task", id: t.id } });
  expect(out).toMatchObject({ kind: "task", id: t.id, action: "appended" });
  const rec = await record("tasks", t.id);
  expect(rec.rev).toBe(2);
  expect(rec.notes).toContain("Words from the page");
  await expect(pb.tasks.update(s, t.id, 1, { title: "stale" })).rejects.toBeInstanceOf(pb.Conflict);

  const made = await clip({ target: { kind: "newtask", title: "Clipped task" }, tags: ["x"] });
  expect(made).toMatchObject({ kind: "task", action: "created" });
  expect(await record("tasks", made.id)).toMatchObject({ rev: 1, tags: ["x"], title: "Clipped task" });
});

test("tags rename: every note and task carrying it is a rev write, columns copied out of the text", async () => {
  const from = `old${id()}`, to = `new${id()}`;
  const n = await pb.create(s, `notes/${id()}.md`, `---\ntitle: "Tagged"\ntags: [${from}, keep]\n---\nBody\n`);
  const t = await pb.tasks.create(s, newTask(id(), { title: "Tagged task", tags: [from] }));
  const res = await pb.call(s, "tefnotes/tags/rename", pb.json("POST", { from, to }));
  expect(res).toMatchObject({ tag: to, notes: 1, tasks: 1 });
  const rec = await record("notes", n.rec);
  expect(rec).toMatchObject({ ...pb.noteColumns(n.path, rec.text), rev: 2, tags: [to, "keep"] });
  expect(await record("tasks", t.id)).toMatchObject({ rev: 2, tags: [to] });
  await expect(pb.update(s, n, "# stale\n")).rejects.toBeInstanceOf(pb.Conflict);
});
