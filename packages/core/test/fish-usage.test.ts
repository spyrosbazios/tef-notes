import { expect, test } from "bun:test";
import { dictationCostOf, fishUsageOf, periodStarts } from "../src/fish-usage";

test("a week starts on Monday and a month on the 1st, at midnight", () => {
  const { week, month } = periodStarts(new Date(2026, 10, 22, 15, 30)); // a Sunday
  expect(new Date(week)).toEqual(new Date(2026, 10, 16));
  expect(new Date(month)).toEqual(new Date(2026, 10, 1));
  expect(new Date(periodStarts(new Date(2026, 10, 16, 0, 1)).week)).toEqual(new Date(2026, 10, 16));
});

test("dictation is billed by the second, rounded up, at $0.36 an hour", () => {
  expect(dictationCostOf(0.2)).toBeCloseTo(0.0001, 6);
  expect(dictationCostOf(3600)).toBeCloseTo(0.36, 6);
});

test("the reader takes what it can and nothing else", () => {
  expect(fishUsageOf({ week: { talk: 1, total: "x" }, balance: "3", since: 5 })).toEqual({
    week: { talk: 1, dictation: 0, total: 0, seconds: 0 }, month: { talk: 0, dictation: 0, total: 0, seconds: 0 }, balance: null, since: 5,
  });
});
