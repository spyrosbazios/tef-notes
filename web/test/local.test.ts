// The local copy's writes behind memory (lib/local.ts `persister`): batches land in order, one at a time, and a batch that fails
// stays pending, with its error said, until a flush goes through.
import { expect, test } from "bun:test";
import { persister } from "@/lib/local";

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
