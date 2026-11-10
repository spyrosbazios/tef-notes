import { expect, test } from "bun:test";
import { cutOf, DEFAULT_KEEP, joined, keepOf, MAX_PIECE, MIN_PIECE, RATE, spliced, transcriptOf } from "../src/voice";

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

/** `secs` seconds of a tone (speech) or near-silence. */
const sound = (secs: number, loud = true) => Float32Array.from({ length: Math.round(secs * RATE) }, (_, i) => (loud ? 0.3 : 0.001) * Math.sin(i / 5));
const cat = (...xs: Float32Array[]) => { const out = new Float32Array(xs.reduce((n, x) => n + x.length, 0)); let at = 0; for (const x of xs) { out.set(x, at); at += x.length; } return out; };

test("cutOf waits for MIN_PIECE seconds", () => {
  expect(cutOf(cat(sound(3), sound(1, false)))).toBe(0);
});

test("cutOf cuts at a pause once a piece is long enough", () => {
  const pcm = cat(sound(MIN_PIECE), sound(0.5, false));
  expect(cutOf(pcm)).toBe(pcm.length);
  expect(cutOf(sound(MIN_PIECE + 1))).toBe(0); // still talking
});

test("cutOf forces a cut at MAX_PIECE, in the quietest moment of the second half", () => {
  const pcm = cat(sound(MAX_PIECE * 0.7), sound(0.1, false), sound(MAX_PIECE * 0.3));
  const at = cutOf(pcm);
  expect(Math.abs(at - MAX_PIECE * 0.7 * RATE)).toBeLessThan(0.1 * RATE);
});

test("joined drops empty pieces", () => {
  expect(joined(["Buy milk.", " ", "And eggs. "])).toBe("Buy milk. And eggs.");
});
