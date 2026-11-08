import { expect, test } from "bun:test";
import { DEFAULT_KEEP, keepOf, spliced, transcriptOf } from "../src/voice";

test("keepOf takes only an offered choice", () => {
  expect(keepOf(0)).toBe(0);
  expect(keepOf(900)).toBe(900);
  expect(keepOf(42)).toBe(DEFAULT_KEEP);
  expect(keepOf("300")).toBe(DEFAULT_KEEP);
});

test("transcriptOf reads defensively", () => {
  expect(transcriptOf({ text: "  hi there " })).toEqual({ text: "hi there" });
  expect(transcriptOf(null)).toEqual({ text: "" });
  expect(transcriptOf({ text: 3 })).toEqual({ text: "" });
});

test("spliced spaces dictation from what comes before", () => {
  expect(spliced("", "Hello")).toBe("Hello");
  expect(spliced("Buy", "milk")).toBe(" milk");
  expect(spliced("Buy ", "milk")).toBe("milk");
  expect(spliced("Buy", "")).toBe("");
});
