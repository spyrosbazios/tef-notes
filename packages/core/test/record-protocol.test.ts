import { expect, test } from "bun:test";
import { Conflict, Gone, Refused, Unavailable, conflictOf } from "../src/record-contracts";
import { attachments, chats, heardOf, lenses, links, noteCollection, outcomeOf, revCollection, tags, type RecordTransport, type RecordRequest } from "../src/record-protocol";
import { linkRecord, type Link } from "../src/record-links";

function transport(reply: (path: string, request: RecordRequest) => any) {
  const calls: { path: string; request: RecordRequest }[] = [];
  const io: RecordTransport = {
    async request(path, request = {}) { calls.push({ path, request }); return reply(path, request); },
    answer: (e) => e instanceof Failure ? { status: e.status, body: e.body } : undefined,
  };
  return { io, calls };
}
class Failure extends Error { constructor(public status: number, public body: unknown = {}) { super(); } }

test("note policy keeps filters, fields, quoting and read timeout, writes keep rev and marks", async () => {
  const { io, calls } = transport((path) => path.includes("filter=") ? { items: [] } : { id: "a" });
  const notes = noteCollection(io, (r) => r, { fields: "id,text,updated", filter: 'path ~ "notes/%"' });
  expect(await notes.read('notes/a"b.md', 123)).toBeNull();
  expect(calls[0].request.timeout).toBe(123);
  expect(decodeURIComponent(calls[0].path)).toContain('filter=path = "notes/a\\"b.md"');
  await notes.list();
  expect(decodeURIComponent(calls[1].path)).toContain('filter=(path ~ "notes/%")');
  await notes.update({ rec: "a", path: "notes/a.md", rev: 7 }, "body", { tainted: true });
  expect(calls[2].path).toBe("collections/notes/records/a?fields=id,text,updated");
  expect(calls[2].request.body).toMatchObject({ rev: 7, text: "body", tainted: true });
  expect(calls[2].request.body).not.toHaveProperty("kind");
});

test("task pagination terminates on an empty page and batches ids in forties", async () => {
  const { io, calls } = transport((path) => ({ items: path.includes("filter=") ? [] : Array.from({ length: 500 }, (_, i) => ({ id: String(i), rev: 2 })) }));
  const tasks = revCollection("tasks", (r) => ({ id: r.id }));
  expect(await tasks.revs(io)).toHaveLength(500);
  expect(calls).toHaveLength(2);
  expect(decodeURIComponent(calls[1].path)).toContain('filter=id > "499"');
  await tasks.getMany(io, Array.from({ length: 81 }, (_, i) => String(i)));
  expect(calls).toHaveLength(5);
  expect(decodeURIComponent(calls[4].path)).toContain('filter=id = "80"');
  await tasks.getMany(io, []);
  expect(calls).toHaveLength(5);
});

test("gone is null or done; every other failure is its typed outcome, a Conflict kept as it is", async () => {
  let failure: Error = new Failure(404);
  const { io } = transport(() => { throw failure; });
  const tasks = revCollection("tasks", (r) => ({ id: r.id }));
  const notes = noteCollection(io, (r) => r);
  expect(await tasks.get(io, "a")).toBeNull();
  expect(await notes.update({ rec: "a", path: "p", rev: 4 }, "x")).toBeNull();
  await tasks.remove(io, "a", 4);
  await notes.remove({ rec: "a", rev: 4 });
  await links.remove(io, "a");
  const conflict = new Conflict("stale");
  failure = conflict;
  await expect(tasks.update(io, "a", 4, {})).rejects.toBe(conflict);
  for (const [e, type] of [[new Failure(403), Refused], [new Failure(503), Unavailable], [new Error("offline"), Unavailable]] as const) {
    failure = e;
    await expect(tasks.update(io, "a", 4, {})).rejects.toBeInstanceOf(type);
    await expect(notes.get("a")).rejects.toBeInstanceOf(type);
  }
});

test("PocketBase's answers as outcomes: a relation to a deleted record is Gone, a validation Refused with its reason", () => {
  const missing = { message: "Failed to create record.", data: { toNote: { code: "validation_missing_rel_records", message: "Failed to find all relation records with the provided ids." } } };
  expect(outcomeOf(400, missing, "links")).toBeInstanceOf(Gone);
  expect(outcomeOf(404, {}, "x")).toBeInstanceOf(Gone);
  const refused = outcomeOf(400, { message: "Failed to create record.", data: { title: { code: "validation_required", message: "Cannot be blank." } } }, "x");
  expect(refused).toBeInstanceOf(Refused);
  expect(refused.message).toBe("Failed to create record. (title: Cannot be blank.)");
  expect(outcomeOf(403, { message: "Only superusers can perform this action." }, "x").message).toBe("Only superusers can perform this action.");
  for (const status of [408, 429, 500, 502]) expect(outcomeOf(status, {}, "x")).toBeInstanceOf(Unavailable);
  expect(outcomeOf(409, {}, "x")).toBeInstanceOf(Conflict);
});

/** A server of `n` records that pages the way PocketBase does: `sort=id`, `perPage`, and `id > "x"` in the filter (or `page`). */
function server(n: number) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: `r${String(i).padStart(5, "0")}`, rev: 1, order: n - i }));
  const { io, calls } = transport((path) => {
    const q = new URLSearchParams(path.slice(path.indexOf("?") + 1)), per = Number(q.get("perPage")), after = /id > "([^"]+)"/.exec(q.get("filter") ?? "")?.[1];
    const page = Number(q.get("page") ?? 1), from = after == null ? (page - 1) * per : rows.findIndex((r) => r.id > after);
    return { items: from < 0 ? [] : rows.slice(from, from + per) };
  });
  return { rows, io, calls };
}

test("keyset paging: a record deleted between two pages moves no other out of the listing", async () => {
  const { rows, io } = server(1200);
  const tasks = revCollection("tasks", (r) => ({ id: r.id, order: r.order }));
  const want = new Set(rows.map((r) => r.id));
  const revs = tasks.revs(io);
  rows.splice(3, 1);                                             // deleted elsewhere after the first page went out
  const got = new Set((await revs).map((r) => r.id));
  for (const id of want) if (id !== "r00003") expect(got.has(id)).toBe(true);
  const listed = await tasks.list(io);
  expect(listed.length).toBe(1199);
  expect(listed[0]!.order).toBeLessThan(listed[1]!.order);      // sorted by `order` once fetched
});

const link: Link = { id: "a", from: { type: "task", id: "t" }, to: { type: "note", id: "n" }, role: "about" };
test("link replay recovers server id, excludes malformed records and keeps an unrelated refusal", async () => {
  const failure = new Failure(400);
  let existing = true;
  const { io, calls } = transport((_path, request) => {
    if (request.method === "POST") throw failure;
    return { items: [{ id: "invalid" }, ...(existing ? [linkRecord({ ...link, id: "server" })] : [])] };
  });
  expect(await links.add(io, link)).toEqual({ ...link, id: "server" });
  expect(decodeURIComponent(calls[1].path)).toContain('fromTask = "t"');
  existing = false;
  await expect(links.add(io, link)).rejects.toBeInstanceOf(Refused);
});

test("only stale revisions and known unique fields are conflicts", () => {
  expect(conflictOf(409, {}, "stale")).toBeInstanceOf(Conflict);
  for (const field of ["path", "note", "name", "id"]) {
    expect(conflictOf(400, { data: { [field]: { code: "validation_not_unique" } } }, field)).toBeInstanceOf(Conflict);
  }
  expect(conflictOf(400, { data: { title: { code: "validation_not_unique" } } }, "x")).toBeUndefined();
  expect(conflictOf(503, {}, "x")).toBeUndefined();
});

test("a realtime event is a record for the sync engine, or null when the record isn't of its shape", () => {
  const note = { id: "r1", path: "notes/a.md", rev: 3, kind: "note", text: "t", updated: "2026-11-21T10:00:00.000Z" };
  expect(heardOf("notes", "update", note)).toEqual({ topic: "notes", note: { rec: "r1", path: "notes/a.md", rev: 3, kind: "note", text: "t", at: Date.parse(note.updated) } });
  expect(heardOf("notes", "delete", { id: "r1", path: "notes/a.md" })).toEqual({ topic: "notes", gone: { rec: "r1", path: "notes/a.md" } });
  expect(heardOf("notes", "update", { ...note, text: undefined })).toBeNull();      // a record sent without its text
  expect(heardOf("tasks", "create", { id: "t1", rev: 1, title: "x", extra: 1 })).toMatchObject({ topic: "tasks", task: { id: "t1", title: "x", rev: 1 } });
  expect(heardOf("tasks", "create", { id: "t1", title: "x" })).toBeNull();
  expect(heardOf("tasks", "delete", { id: "t1" })).toEqual({ topic: "tasks", gone: "t1" });
  const link: Link = { id: "l1", from: { type: "task", id: "t1" }, to: { type: "note", id: "r1" }, role: "about" };
  expect(heardOf("links", "create", linkRecord(link))).toEqual({ topic: "links", link });
  expect(heardOf("links", "create", { id: "l2", role: "about" })).toBeNull();
  expect(heardOf("links", "delete", { id: "l1" })).toEqual({ topic: "links", gone: "l1" });
  expect(heardOf("notes", "update", null)).toBeNull();
});

test("lenses: oldest first, a create under the caller's id found again after a lost answer, a gone one's delete is done", async () => {
  const lens = { name: "Work", tags: ["work"], exclude: [], accent: null, theme: null };
  let posts = 0, gone = false;
  const { io, calls } = transport((path, r) => {
    if (r.method === "POST") { if (++posts === 1) throw new Failure(503); throw new Failure(400, { data: { id: { code: "validation_not_unique" } } }); }
    if (r.method === "DELETE" && gone) throw new Failure(404);
    if (path.includes("?")) return { items: [{ id: "b", name: "Home", created: "2026-02-01" }, { id: "a", name: "Work", created: "2026-01-01" }] };
    return { id: "abcdefghij01234", ...lens };
  });
  expect((await lenses.list(io)).map((l) => l.rec)).toEqual(["a", "b"]);
  expect((await lenses.create(io, lens, "abcdefghij01234")).rec).toBe("abcdefghij01234");
  expect(calls.filter((c) => c.request.method === "POST").map((c) => (c.request.body as { id: string }).id)).toEqual(["abcdefghij01234", "abcdefghij01234"]);
  expect((await lenses.update(io, "a", lens)).name).toBe("Work");
  gone = true;
  await lenses.remove(io, "a");
});

test("tags: by name, the routes' timeouts and Stop, a failure in the server's own words", async () => {
  let fail: Failure | null = null;
  const { io, calls } = transport((path) => {
    if (fail) throw fail;
    if (path.startsWith("collections/tags/records?")) return { items: [{ id: "2", name: "work" }, { id: "1", name: "home" }] };
    if (path === "tefnotes/tags/guess") return { tags: ["work", 3] };
    if (path === "tefnotes/tags/describe") return { description: "Paid work" };
    return { id: "1", name: "home", description: "" };
  });
  expect((await tags.list(io)).map((t) => t.name)).toEqual(["home", "work"]);
  await tags.create(io, { name: "Home", description: "hint" }, "abcdefghij01234", "agent");
  expect(calls[1].request.body).toEqual({ id: "abcdefghij01234", name: "Home", color: "", description: "hint", describedBy: "agent" });
  const stop = new AbortController();
  expect(await tags.guess(io, { title: "Email", notes: "" }, stop.signal)).toEqual(["work"]);
  expect(calls[2].request).toMatchObject({ method: "POST", timeout: 20_000, signal: stop.signal });
  expect(await tags.describe(io, "work")).toBe("Paid work");
  expect(calls[3].request).toMatchObject({ body: { tag: "work" }, timeout: 90_000 });
  fail = new Failure(400, { error: "No note carries that tag." });
  await expect(tags.describeAll(io)).rejects.toThrow(new Refused("No note carries that tag."));
  fail = new Failure(502, { error: "The model failed." });
  await expect(tags.rename(io, "a", "b")).rejects.toThrow(new Unavailable("The model failed."));
});

test("attachments: a note's in the order added, an upload as a form, a name taken is a Conflict", async () => {
  let taken = false;
  const { io, calls } = transport((_path, r) => {
    if (r.method === "POST") { if (taken) throw new Failure(400, { data: { name: { code: "validation_not_unique" } } }); return { id: "p1", note: "n1", name: "a.jpg", file: "a_x.jpg" }; }
    return { items: [{ id: "z", note: "n1", name: "b.jpg", file: "b", created: "2026-01-02" }, { id: "y", note: "n1", name: "a.jpg", file: "a", created: "2026-01-01" }] };
  });
  expect((await attachments.list(io, "n1")).map((p) => p.name)).toEqual(["a.jpg", "b.jpg"]);
  expect(decodeURIComponent(calls[0].path)).toContain('filter=(note = "n1")');
  expect(await attachments.upload(io, "n1", "a.jpg", new Blob(["x"]))).toEqual({ rec: "p1", note: "n1", name: "a.jpg", file: "a_x.jpg" });
  const form = calls[1].request.body as FormData;
  expect([form.get("note"), form.get("name"), (form.get("file") as File).name]).toEqual(["n1", "a.jpg", "a.jpg"]);
  taken = true;
  await expect(attachments.upload(io, "n1", "a.jpg", new Blob(["x"]))).rejects.toBeInstanceOf(Conflict);
});

test("chats: newest first, one read with its history and rev, a create in the current format, a save at its rev", async () => {
  const history = [{ id: "m", role: "user" as const, parts: [{ type: "text", text: "hi" }] }];
  let missing = false;
  const { io, calls } = transport((path, r) => {
    if (missing) throw new Failure(404);
    if (r.method === "PATCH") return { rev: 5 };
    if (r.method === "POST") return { id: "c2", title: "New", updated: "now" };
    if (path.startsWith("collections/chats/records?")) return { items: [{ id: "c1", title: "Old", updated: "2026-01-01" }, { id: "c2", title: "New", updated: "2026-02-01" }] };
    return { id: "c1", title: "Old", updated: "2026-01-01", rev: 4, messages: history };
  });
  expect((await chats.list(io)).map((c) => c.id)).toEqual(["c2", "c1"]);
  expect(await chats.get(io, "c1")).toEqual({ id: "c1", title: "Old", updated: "2026-01-01", rev: 4, messages: history });
  await chats.create(io, "c2", "New");
  expect(calls[2].request.body).toEqual({ id: "c2", title: "New", historyVersion: 1, messages: [] });
  expect(await chats.save(io, "c1", 4, { messages: history, title: "Old", model: "m" })).toBe(5);
  expect(calls[3].request.body).toMatchObject({ rev: 4, title: "Old", model: "m", historyVersion: 1 });
  missing = true;
  expect(await chats.get(io, "c1")).toBeNull();
  await chats.remove(io, "c1");
});

test("a create the transport never sent (a browser offline) goes back at once: it can't have landed", async () => {
  let tries = 0;
  const { io } = transport(() => { tries++; throw new Unavailable("offline", true); });
  await expect(chats.create(io, "c1", "New")).rejects.toThrow("offline");
  expect(tries).toBe(1);
});
