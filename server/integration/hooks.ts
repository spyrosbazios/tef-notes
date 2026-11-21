// The server's own writers (pb_hooks over lib/records.js) against a real PocketBase: each keeps the rev contract a
// client's write is held to, and a client's next write over what they wrote meets it.
import { expect, test } from "bun:test";
import * as pb from "../../packages/core/src/pocketbase";
import { newTask } from "../../packages/core/src/todo";
import { serverError } from "../../packages/core/src/http";

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

test("clip: a new note starts at rev 1, tainted, with its columns copied out of its text", async () => {
  const out = await clip({ target: { kind: "new" }, tags: ["clipped"] });
  expect(out).toMatchObject({ kind: "note", action: "created" });
  const n = await pb.read(s, out.path);
  const rec = await record("notes", n!.rec);
  expect(rec).toMatchObject({ ...pb.noteColumns(out.path, rec.text), rev: 1, kind: "note", tags: ["clipped"], tainted: true });
  expect(rec.text).toContain("Words from the page");
});

test("clip: an append to a note bumps rev and copies its columns; the client's stale write is refused", async () => {
  const n = await pb.create(s, `notes/${id()}.md`, '---\ntitle: "Target"\ntags: [a]\n---\nFirst\n');
  const out = await clip({ target: { kind: "note", path: n.path }, tags: ["b"] });
  expect(out).toMatchObject({ kind: "note", path: n.path, title: "Target", action: "appended" });
  const rec = await record("notes", n.rec);
  expect(rec).toMatchObject({ ...pb.noteColumns(n.path, rec.text), rev: 2, tags: ["a", "b"], tainted: true });
  expect(rec.text).toContain("Words from the page");
  await expect(pb.update(s, n, "# Mine\n")).rejects.toBeInstanceOf(pb.Conflict);
  expect((await pb.update(s, { ...n, rev: 2 }, "# Mine\n"))?.rev).toBe(3);
});

test("clip: an append to a task bumps rev; a new task starts at rev 1", async () => {
  const t = await pb.tasks.create(s, newTask(id(), { title: "Existing" }));
  const out = await clip({ target: { kind: "task", id: t.id } });
  expect(out).toMatchObject({ kind: "task", id: t.id, action: "appended" });
  const rec = await record("tasks", t.id);
  expect(rec).toMatchObject({ rev: 2, tainted: true });
  expect(rec.notes).toContain("Words from the page");
  await expect(pb.tasks.update(s, t.id, 1, { title: "stale" })).rejects.toBeInstanceOf(pb.Conflict);

  const made = await clip({ target: { kind: "newtask", title: "Clipped task" }, tags: ["x"] });
  expect(made).toMatchObject({ kind: "task", action: "created" });
  expect(await record("tasks", made.id)).toMatchObject({ rev: 1, tags: ["x"], title: "Clipped task", tainted: true });
});

test("clip: under the owner's lens, a new note or task takes its tag on the server; an append takes the picks alone", async () => {
  const lens = await pb.call(s, "collections/lenses/records", pb.json("POST", { name: "Work", tags: [" #Work ", "clients"] }));
  const prefs = await pb.call(s, "collections/prefs/records", pb.json("POST", { key: "owner", data: { lens: lens.id } }));
  try {
    const note = await clip({ target: { kind: "new" }, tags: ["ideas"] });
    expect((await record("notes", (await pb.read(s, note.path))!.rec)).tags).toEqual(["ideas", "Work"]);
    const task = await clip({ target: { kind: "newtask", title: "Under the lens" }, tags: ["work"] });
    expect((await record("tasks", task.id)).tags).toEqual(["work"]);             // picked already, ignoring case
    const n = await pb.create(s, `notes/${id()}.md`, '---\ntitle: "Mine"\ntags: [a]\n---\nFirst\n');
    await clip({ target: { kind: "note", path: n.path }, tags: ["b"] });
    expect((await record("notes", n.rec)).tags).toEqual(["a", "b"]);
  } finally {
    await pb.call(s, `collections/prefs/records/${prefs.id}`, { method: "DELETE" });
  }
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

test("tainted: a write never takes the mark off a note or a task", async () => {
  const n = await pb.create(s, `notes/${id()}.md`, "# Web text\n", { tainted: true });
  const patched = await pb.call(s, `collections/notes/records/${n.rec}`, pb.json("PATCH", { ...pb.noteColumns(n.path, "# Mine now\n"), rev: n.rev, tainted: false }));
  expect(patched).toMatchObject({ rev: 2, tainted: true });
  const t = await pb.tasks.create(s, newTask(id(), { title: "Web task" }), { tainted: true });
  const task = await pb.call(s, `collections/tasks/records/${t.id}`, pb.json("PATCH", { rev: t.rev, title: "Mine", tainted: false }));
  expect(task).toMatchObject({ rev: 2, title: "Mine", tainted: true });
  const plain = await pb.create(s, `notes/${id()}.md`, "# Mine\n");
  expect((await record("notes", plain.rec)).tainted).toBe(false);
});

test("tags: describedBy is decided by the server; a request can only mark a description an agent's", async () => {
  const tag = (body: Record<string, unknown>) => pb.call(s, "collections/tags/records", pb.json("POST", { name: id(), ...body }));
  const patch = (rec: string, body: Record<string, unknown>) => pb.call(s, `collections/tags/records/${rec}`, pb.json("PATCH", body));
  expect((await tag({ description: "Mine" })).describedBy).toBe("owner");
  expect((await tag({ description: "Forged", describedBy: "auto" })).describedBy).toBe("owner");
  expect((await tag({ describedBy: "owner" })).describedBy).toBe("");
  const agent = await tag({ description: "An agent's", describedBy: "agent" });
  expect(agent.describedBy).toBe("agent");
  expect((await patch(agent.id, { color: "blue", describedBy: "owner" })).describedBy).toBe("agent");
  expect((await patch(agent.id, { description: "Still an agent's", describedBy: "agent" })).describedBy).toBe("agent");
  expect((await patch(agent.id, { description: "The owner's now" })).describedBy).toBe("owner");
  expect((await patch(agent.id, { color: "red", describedBy: "agent" })).describedBy).toBe("owner");
});

test("every route answers a failure as { error } alone (lib/http.js), which the clients read with core serverError", async () => {
  const refused = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${url}/api/${path}`, init);
    const body = await res.json();
    return { status: res.status, keys: Object.keys(body), error: serverError(body) };
  };
  const post = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const private_ = encodeURIComponent("http://10.0.0.1/");
  for (const [path, init] of [
    [`tefnotes/link-preview?url=${private_}`],
    [`tefnotes/page?url=${private_}`],
    [`tefnotes/clip/image?url=${private_}`],
    ["tefnotes/summary", post({ url: "http://10.0.0.1/" })],
    ["tefnotes/tags/rename", post({ from: "a" })],
    ["tefnotes/tags/describe", post({})],
    ["tefnotes/tags/guess", post({ title: 3 })],
    ["tefnotes/clip/suggest", post({ title: "" })],
  ] as [string, RequestInit?][]) {
    const r = await refused(path, init);
    expect([path, r.status, r.keys]).toEqual([path, 400, ["error"]]);
    expect(r.error?.length).toBeGreaterThan(3);
  }
});
