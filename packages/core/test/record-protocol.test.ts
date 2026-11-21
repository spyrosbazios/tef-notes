import { expect, test } from "bun:test";
import { Conflict, Gone, Refused, Unavailable, conflictOf } from "../src/record-contracts";
import { links, noteCollection, outcomeOf, revCollection, type RecordTransport, type RecordRequest } from "../src/record-protocol";
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
