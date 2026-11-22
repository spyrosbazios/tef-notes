import { expect, test } from "bun:test";
import { FishLedger } from "../src/fish-usage";

test("the ledger sums each kind since a start", () => {
  let now = 1000;
  const l = new FishLedger(":memory:", () => now);
  l.record({ kind: "talk", seconds: 60, bytes: 100, cost: 0.01 });
  now = 5000;
  l.record({ kind: "dictation", seconds: 4, bytes: 0, cost: 0.0004 });
  l.record({ kind: "talk", seconds: 0, bytes: 0, cost: 0 });     // nothing used: not a row
  expect(l.since(0)).toEqual({ talk: 0.01, dictation: 0.0004, total: 0.0104, seconds: 64 });
  expect(l.since(2000)).toEqual({ talk: 0, dictation: 0.0004, total: 0.0004, seconds: 4 });
  expect(l.first()).toBe(1000);
});
