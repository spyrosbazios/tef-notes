// lib/records.js: the rev compare-and-swap every hook writer goes through, over a fake transaction.
import { describe, expect, test } from "bun:test";
import lib from "../pb_hooks/lib/records.js";

const { casWrite, create } = lib;

/** A record as PocketBase's JS API shows one: get/set by field. */
class Rec {
  constructor(collection, fields = {}) { this.collection = collection; this.fields = { ...fields }; this.id = fields.id ?? ""; }
  getString(k) { return this.fields[k] == null ? "" : String(this.fields[k]); }
  getInt(k) { return Number(this.fields[k] ?? 0); }
  set(k, v) { this.fields[k] = v; }
}
globalThis.Record = class extends Rec { constructor(c) { super(c.name); } };

/** A transaction over `rows` by collection and id; `saved` lists what was saved, in order. */
function fakeTx(rows) {
  const saved = [];
  return {
    saved,
    findRecordById: (c, id) => {
      const f = rows[c]?.[id];
      if (!f) throw new Error("not found");
      return new Rec(c, { ...f, id });
    },
    findCollectionByNameOrId: (name) => ({ name }),
    save: (rec) => { if (!rec.id) rec.id = `new${saved.length}`; saved.push(rec); },
  };
}

const NOTE = '---\ntitle: "Old"\ncreated: 2026-11-01\ntags: [a]\n---\nBody\n';

describe("casWrite", () => {
  test("re-reads, mutates, copies a note's columns, bumps rev and saves", () => {
    const tx = fakeTx({ notes: { n1: { path: "notes/x.md", text: NOTE, rev: 4, title: "stale", tags: ["stale"] } } });
    const rec = casWrite(tx, "notes", "n1", (r) => r.set("text", NOTE.replace("Old", "New").replace("[a]", "[a, b]")));
    expect(tx.saved).toEqual([rec]);
    expect(rec.fields).toMatchObject({ rev: 5, title: "New", tags: ["a", "b"], day: "2026-11-01", path: "notes/x.md" });
    expect(rec.fields.tainted).toBeUndefined();
  });
  test("a task gets no note columns", () => {
    const tx = fakeTx({ tasks: { t1: { title: "T", rev: 1 } } });
    const rec = casWrite(tx, "tasks", "t1", (r) => r.set("notes", "more"));
    expect(rec.fields).toEqual({ id: "t1", title: "T", rev: 2, notes: "more" });
  });
  test("taint marks it", () => {
    const tx = fakeTx({ tasks: { t1: { rev: 1 } } });
    expect(casWrite(tx, "tasks", "t1", () => {}, { taint: true }).fields.tainted).toBe(true);
  });
  test("nothing is written for a record gone, moved since expectRev, or a mutate that declines", () => {
    const tx = fakeTx({ tasks: { t1: { rev: 3 } } });
    expect(casWrite(tx, "tasks", "gone", () => {})).toBeNull();
    expect(casWrite(tx, "tasks", "t1", () => {}, { expectRev: 2 })).toBeNull();
    expect(casWrite(tx, "tasks", "t1", () => false)).toBeNull();
    expect(tx.saved).toEqual([]);
    expect(casWrite(tx, "tasks", "t1", () => {}, { expectRev: 3 })?.fields.rev).toBe(4);
  });
});

describe("create", () => {
  test("a new note at rev 1 with its columns, tainted when asked", () => {
    const tx = fakeTx({});
    const rec = create(tx, "notes", (r) => { r.set("path", "notes/y.md"); r.set("text", NOTE); }, { taint: true });
    expect(tx.saved).toEqual([rec]);
    expect(rec.fields).toMatchObject({ rev: 1, title: "Old", tags: ["a"], tainted: true });
  });
  test("a task untainted unless asked", () => {
    const rec = create(fakeTx({}), "tasks", (r) => r.set("title", "T"));
    expect(rec.fields).toEqual({ title: "T", rev: 1 });
  });
});
