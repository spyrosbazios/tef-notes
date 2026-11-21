// The local copy's writes behind memory (lib/local.ts `persister`): batches land in order, one at a time, and a batch that fails
// stays pending, with its error said, until a flush goes through.
import { expect, test } from "bun:test";
import { ROWS_VERSION } from "@/core/rows";
import { freshNote } from "@/core/sync";
import { persister, readStored } from "@/lib/local";

test("flushes are chained: a later batch never lands before an earlier one", async () => {
  const landed: [string, unknown][][] = [];
  let release!: () => void;
  const first = new Promise<void>((r) => { release = r; });
  let calls = 0;
  const p = persister(async (batch) => { if (calls++ === 0) await first; landed.push(batch); });
  p.note("n:a", { v: 1 });
  const one = p.flush();
  await Bun.sleep(0);                                          // the first batch is out
  p.note("n:a", null);                                         // deleted after the put went out
  const two = p.flush();
  release();
  await Promise.all([one, two]);
  expect(landed).toEqual([[["n:a", { v: 1 }]], [["n:a", null]]]);
});

test("a batch that fails stays pending and says why; the next flush sends it, newer rows winning", async () => {
  let fail = true;
  const landed: [string, unknown][][] = [];
  const p = persister(async (batch) => { if (fail) throw new Error("QuotaExceededError"); landed.push(batch); });
  let heard = 0;
  p.watch(() => heard++);
  p.note("n:a", { v: 1 });
  p.note("t:b", { v: 1 });
  await p.flush();
  expect(p.error()).toContain("QuotaExceededError");
  expect(heard).toBe(1);
  p.note("n:a", { v: 2 });
  fail = false;
  await p.flush();
  expect(landed).toEqual([[["n:a", { v: 2 }], ["t:b", { v: 1 }]]]);
  expect(p.error()).toBeUndefined();
  expect(heard).toBe(2);
  await p.flush();
  expect(landed.length).toBe(1);                               // nothing left pending
});

test("a row changed while its batch was out stays pending for the next", async () => {
  const landed: [string, unknown][][] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let calls = 0;
  const p = persister(async (batch) => { if (calls++ === 0) await gate; landed.push(batch); });
  p.note("n:a", { v: 1 });
  const out = p.flush();
  await Bun.sleep(0);
  p.note("n:a", { v: 2 });
  release();
  await out;
  await p.flush();
  expect(landed).toEqual([[["n:a", { v: 1 }]], [["n:a", { v: 2 }]]]);
});

// ---- the stored copy read back (lib/local.ts `readStored`, over core/rows.ts)

test("a store of this build's shape is read as it is; a row that isn't one is dropped from it", () => {
  const note = freshNote("r1", "notes/a.md", "a", 1);
  const read = readStored([["v", ROWS_VERSION], ["n:notes/a.md", note], ["t:x", { id: "x" }], ["q:other", 1]]);
  expect(read).toEqual({ rows: { notes: [["notes/a.md", note]], tasks: [], links: [] }, writes: [["t:x", null], ["q:other", null]], newer: false });
});

test("a store from before rows had a version gets one, and a note stored without a record id gets one (the one-shot migration)", () => {
  const old = { ...freshNote("x", "notes/a.md", "a", 1), rec: null };
  const read = readStored([["n:notes/a.md", old]]);
  const [[path, row]] = read.rows.notes as [string, { rec: string }][];
  expect(path).toBe("notes/a.md");
  expect(row.rec).toMatch(/^[a-z0-9]{15}$/);
  expect(read.writes).toEqual([["n:notes/a.md", row], ["v", ROWS_VERSION]]);
  expect(readStored([]).writes).toEqual([["v", ROWS_VERSION]]);
});

test("a store a newer build wrote is left alone", () => {
  expect(readStored([["v", ROWS_VERSION + 1], ["n:notes/a.md", { anything: true }]])).toEqual({ rows: { notes: [], tasks: [], links: [] }, writes: [], newer: true });
});
