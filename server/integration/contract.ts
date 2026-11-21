import { expect, test } from "bun:test";
import * as pb from "../../packages/core/src/pocketbase";
import { DEFAULT_PREFS } from "../../packages/core/src/prefs";
import { patchPrefs, prefsRemote } from "../../packages/core/src/prefs-sync";
import { newTask } from "../../packages/core/src/todo";
import { linkRecord, newLink } from "../../packages/core/src/record-links";
import { readChatHistory, serializeChatHistory } from "../../packages/core/src/chat-history";

const url = process.env.TEF_CONTRACT_URL;
if (!url || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw new Error("Run bun --no-env-file server/integration/run.ts");
const s = { url };
let serial = 0;
const id = () => `contract${String(++serial).padStart(7, "0")}`;
const note = () => pb.create(s, pb.recordId(), `notes/${id()}.md`, "# Contract\n");
const task = () => pb.tasks.create(s, newTask(id(), { title: "Contract task" }));
const record = (collection: string, id: string) => `collections/${collection}/records/${id}`;
const raw = (path: string, method: string, body?: unknown) => fetch(`${url}/api/${path}`, body === undefined ? { method } : pb.json(method, body));

test("chat history: additive version preserves legacy messages and opaque historical tool results", async () => {
  const messages = [{ id: "old-message", role: "assistant" as const, parts: [{
    type: "tool-retired_tool", toolCallId: "old-call", state: "output-available",
    input: { oldField: "original input" }, output: { card: { title: "Original card", custom: [1, true] } },
  }] }];
  const created = await pb.call(s, "collections/chats/records", pb.json("POST", { title: "Legacy chat", messages }));
  expect(created.historyVersion).toBe(0);
  expect(readChatHistory(created)).toEqual(messages);
  const path = record("chats", created.id);
  await pb.call(s, path, pb.json("PATCH", serializeChatHistory(readChatHistory(created))));
  const updated = await pb.call(s, path);
  expect(updated).toMatchObject({ historyVersion: 1, messages });
  expect(readChatHistory(updated)).toEqual(messages);
  await pb.call(s, path, pb.json("PATCH", { historyVersion: 2 }));
  const future = await pb.call(s, path);
  expect(() => readChatHistory(future)).toThrow("Unsupported chat history version");
  expect(await pb.call(s, path)).toEqual(future);
});

for (const collection of ["notes", "tasks"] as const) {
  test(`${collection}: create, CAS update/delete, missing rev and stale refusal preserve data`, async () => {
    const initial = collection === "notes" ? await note() : await task();
    const rec = "rec" in initial ? initial.rec : initial.id;
    const path = record(collection, rec);
    expect(initial.rev).toBe(1);
    expect((await raw(path, "PATCH", { title: "Missing rev" })).status).toBe(400);
    expect((await raw(path, "DELETE")).status).toBe(400);
    const changed = collection === "notes"
      ? await pb.update(s, initial as pb.Remote, "# Changed\n")
      : await pb.tasks.update(s, rec, initial.rev, { title: "Changed" });
    expect(changed?.rev).toBe(2);
    const before = await pb.call(s, path);
    expect((await raw(path, "PATCH", { rev: 1, title: "Stale" })).status).toBe(409);
    expect((await raw(`${path}?rev=1`, "DELETE")).status).toBe(409);
    await expect(collection === "notes" ? pb.update(s, initial as pb.Remote, "stale") : pb.tasks.update(s, rec, 1, { title: "stale" })).rejects.toBeInstanceOf(pb.Conflict);
    await expect(collection === "notes" ? pb.remove(s, { rec, rev: 1 }) : pb.tasks.remove(s, rec, 1)).rejects.toBeInstanceOf(pb.Conflict);
    expect(await pb.call(s, path)).toEqual(before);
    if (collection === "notes") await pb.remove(s, { rec, rev: 2 });
    else await pb.tasks.remove(s, rec, 2);
    expect((await raw(path, "GET")).status).toBe(404);
    if (collection === "notes") {
      expect(await pb.get(s, rec)).toBeNull();
      await pb.remove(s, { rec, rev: 2 });
    } else {
      expect(await pb.tasks.get(s, rec)).toBeNull();
      await pb.tasks.remove(s, rec, 2);
    }
  });
}

test("keyset paging's filter: `id > last` sorted by id, beside a listing's own filter", async () => {
  const [a, b] = [await task(), await task()];
  const after = (last: string) => pb.call(s, `collections/tasks/records?fields=id&sort=id&perPage=500&skipTotal=1&filter=${encodeURIComponent(`(rev >= 1) && id > ${pb.lit(last)}`)}`);
  const ids = (await after(a.id)).items.map((r: { id: string }) => r.id);
  expect(ids).toContain(b.id);
  expect(ids).not.toContain(a.id);
  expect(ids).toEqual([...ids].sort());
});

test("noteColumns survive HTTP create/update; path and kind are immutable", async () => {
  const path = `notes/${id()}.md`;
  const text = '---\ntitle: "Δοκιμή"\ncreated: 2026-11-14\npinned: true\narchived: true\ncolor: blue\ntags: [work, home]\n---\nBody\n';
  const rec = pb.recordId(), n = await pb.create(s, rec, path, text);
  expect(n.rec).toBe(rec);                                   // the client's own record id, as tasks have theirs
  expect(await pb.call(s, record("notes", n.rec))).toMatchObject({ ...pb.noteColumns(path, text), rev: 1, kind: "note" });
  await expect(pb.create(s, rec, `notes/${id()}.md`, text)).rejects.toBeInstanceOf(pb.Conflict);   // its id taken: it landed before
  expect(pb.noteColumns(path, text)).toMatchObject({ title: "Δοκιμή", day: "2026-11-14", pinned: true, archived: true, color: "blue", tags: ["work", "home"] });
  await expect(pb.create(s, pb.recordId(), path, text)).rejects.toBeInstanceOf(pb.Conflict);
  for (const patch of [{ path: "notes/moved.md" }, { kind: "capture" }]) {
    expect((await raw(record("notes", n.rec), "PATCH", { rev: n.rev, ...patch })).status).toBe(400);
  }
  await expect(pb.update(s, { ...n, path: "notes/moved.md" }, text)).rejects.toBeInstanceOf(pb.Refused);
  expect(await pb.get(s, n.rec)).toEqual(n);
  const cleared = "# Plain\nNo frontmatter.\n";
  await pb.update(s, n, cleared);
  expect(await pb.call(s, record("notes", n.rec))).toMatchObject({ ...pb.noteColumns(path, cleared), rev: 2, kind: "note" });
});

test("links: idempotent replay, unique ends/role, shape checks and cascades on either end", async () => {
  const n = await note(), t = await task();
  const l = newLink(id(), { type: "task", id: t.id }, { type: "note", id: n.rec }, "about");
  expect(await pb.links.add(s, l)).toEqual(l);
  expect(await pb.links.add(s, l)).toEqual(l);
  expect(await pb.links.add(s, { ...l, id: id() })).toEqual(l);
  const duplicate = await raw("collections/links/records", "POST", linkRecord({ ...l, id: id() }));
  expect(duplicate.status).toBe(400);
  expect(await pb.links.of(s, l.to)).toEqual([l]);
  const source = await pb.links.add(s, { ...l, id: id(), role: "source" });
  expect((await pb.links.of(s, l.to)).length).toBe(2);
  expect((await raw(record("links", l.id), "PATCH", { role: "source" })).status).toBe(403);
  await pb.links.remove(s, source.id);
  for (const fields of [
    { fromTask: t.id, toTask: t.id, role: "about" },
    { fromTask: t.id, fromNote: n.rec, toNote: n.rec, role: "about" },
    { fromTask: t.id, role: "about" },
    { fromTask: t.id, toNote: n.rec, role: "unknown" },
    { fromTask: t.id, toNote: "missing00000000", role: "about" },
  ]) expect((await raw("collections/links/records", "POST", fields)).status).toBe(400);
  expect((await pb.get(s, n.rec))?.rev).toBe(1);
  expect((await pb.tasks.get(s, t.id))?.rev).toBe(1);
  await pb.remove(s, n);
  expect(await pb.links.of(s, l.from)).toEqual([]);
  // A link to a note deleted meanwhile: what PocketBase answers, and the protocol's typed outcome for it (the sync drops it)
  const dangling = newLink(id(), l.from, { type: "note", id: n.rec }, "about");
  const refused = await raw("collections/links/records", "POST", linkRecord(dangling));
  expect(refused.status).toBe(400);
  expect((await refused.json()).data.toNote.code).toBe("validation_missing_rel_records");
  await expect(pb.links.add(s, dangling)).rejects.toBeInstanceOf(pb.Gone);
  expect((await pb.tasks.get(s, t.id))?.rev).toBe(1);
  const n2 = await note();
  const l2 = await pb.links.add(s, { ...l, id: id(), to: { type: "note", id: n2.rec } });
  await pb.tasks.remove(s, t.id, t.rev);
  expect(await pb.links.of(s, l2.to)).toEqual([]);
  expect((await pb.get(s, n2.rec))?.rev).toBe(1);
  await pb.links.remove(s, l2.id);
  await pb.links.remove(s, l2.id);
});

test("attachments: multipart, exact download, name uniqueness and note deletion cleanup", async () => {
  const n = await note(), other = await note();
  const owner = n.path.slice(6, -3), otherOwner = other.path.slice(6, -3);
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5V8AAAAASUVORK5CYII=", "base64");
  const file = new Blob([bytes], { type: "image/png" });
  const photo = await pb.upload(s, owner, "pixel.png", file);
  expect(await pb.photos(s, owner)).toEqual([photo]);
  const downloaded = await fetch(pb.photoUrl(s, photo));
  expect(downloaded.status).toBe(200);
  expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes);
  await expect(pb.upload(s, owner, "pixel.png", file)).rejects.toBeInstanceOf(pb.Conflict);
  const survivor = await pb.upload(s, otherOwner, "pixel.png", file);
  expect((await pb.get(s, n.rec))?.rev).toBe(1);
  await expect(pb.remove(s, { rec: n.rec, rev: 0 })).rejects.toBeInstanceOf(pb.Conflict);
  expect(await pb.photos(s, owner)).toEqual([photo]);
  await pb.remove(s, n);
  expect(await pb.photos(s, owner)).toEqual([]);
  expect((await fetch(pb.photoUrl(s, photo))).status).toBe(404);
  expect(await pb.photos(s, otherOwner)).toEqual([survivor]);
  await pb.removePhoto(s, survivor.rec);
  await pb.removePhoto(s, survivor.rec);
  expect(await pb.photos(s, otherOwner)).toEqual([]);
});

test("search: a typed % or _ matches itself, not any text (PocketBase reads a bare % as a pattern)", async () => {
  const percent = await pb.create(s, pb.recordId(), `notes/${id()}.md`, "# Hit\nzqprice 100% sure\n");
  const wild = await pb.create(s, pb.recordId(), `notes/${id()}.md`, "# Miss\nzqprice 100 sure\n");
  const under = await pb.create(s, pb.recordId(), `notes/${id()}.md`, "# Hit\nzq_name\n");
  const other = await pb.create(s, pb.recordId(), `notes/${id()}.md`, "# Miss\nzqXname\n");
  const found = async (q: string) => (await pb.search(s, q)).map((n) => n.rec).sort();
  expect(await found("100%")).toEqual([percent.rec]);
  expect(await found("zqprice 100")).toEqual([percent.rec, wild.rec].sort());
  expect(await found("zq_name")).toEqual([under.rec]);
  expect(await found("zq")).toEqual([percent.rec, wild.rec, under.rec, other.rec].sort());
  for (const n of [percent, wild, under, other]) await pb.remove(s, n);

test("preferences: made at rev 1, saves are compare-and-swap, and a stale writer goes over the newer record", async () => {
  const remote = prefsRemote(pb.transport(s));
  expect(await remote.get()).toBeNull();
  const first = await remote.save(null, DEFAULT_PREFS);
  expect(first.rev).toBe(1);
  await expect(remote.save(null, DEFAULT_PREFS)).rejects.toBeInstanceOf(pb.Conflict);
  const path = record("prefs", first.rec);
  expect((await raw(path, "PATCH", { data: {} })).status).toBe(400);
  const second = await patchPrefs(remote, { theme: "dawn" });
  expect(second.rev).toBe(2);
  const before = await pb.call(s, path);
  expect((await raw(path, "PATCH", { rev: 1, data: {} })).status).toBe(409);
  await expect(remote.save({ rec: first.rec, rev: 1 }, DEFAULT_PREFS)).rejects.toBeInstanceOf(pb.Conflict);
  expect(await pb.call(s, path)).toEqual(before);
  // A writer that read rev 2 and lost to another's save redoes its path over the newer one
  const real = pb.transport(s);
  let raced = false;
  const stale = prefsRemote({
    status: real.status,
    async request(p, r) {
      const out = await real.request(p, r);
      if (!raced && r?.method === undefined) { raced = true; await patchPrefs(remote, { accent: "rose" }); }
      return out;
    },
  });
  const saved = await patchPrefs(stale, { lens: "work" });
  expect(saved.prefs).toMatchObject({ theme: "dawn", accent: "rose", lens: "work" });
});

test("tasks: a repeat takes a month's anchor on months and years only", async () => {
  const t = await pb.tasks.create(s, newTask(id(), { title: "Rent", when: "2027-02-28", every: "1m@30" }));
  expect(t.every).toBe("1m@30");
  await pb.tasks.create(s, newTask(id(), { title: "Birthday", when: "2029-02-28", every: "1y@29" }));
  for (const every of ["1w@30", "1m@28", "+1m@30", "1m@"]) {
    expect((await raw("collections/tasks/records", "POST", { ...newTask(id(), { title: "Bad" }), every })).status).toBe(400);
  }
});
