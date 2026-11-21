import { describe, expect, test } from "bun:test";
import { mergedWrite, noteReadOf, previewWrite } from "../src/note-read";

describe("noteReadOf", () => {
  test("a whole read_note answer: path, rev, text", () => {
    expect(noteReadOf({ path: "notes/a.md", rev: 3, text: "x\n" })).toEqual({ path: "notes/a.md", rev: 3, text: "x\n" });
  });
  test("an error, a clipped text, a missing or odd rev is no base", () => {
    expect(noteReadOf({ error: "notes/a.md not found." })).toBeNull();
    expect(noteReadOf({ path: "notes/a.md", rev: 3, text: "x", truncated: true, chars: 30000 })).toBeNull();
    expect(noteReadOf({ path: "notes/a.md", text: "x" })).toBeNull();
    expect(noteReadOf({ path: "notes/a.md", rev: 1.5, text: "x" })).toBeNull();
    expect(noteReadOf(null)).toBeNull();
    expect(noteReadOf("text")).toBeNull();
  });
});

describe("mergedWrite", () => {
  const base = "one\ntwo\nthree\n";
  test("the file as it was read: the write as it is", () => {
    expect(mergedWrite(base, "ONE\ntwo\nthree\n", base)).toBe("ONE\ntwo\nthree\n");
  });
  test("an edit made since, elsewhere in the file: both kept", () => {
    expect(mergedWrite(base, "ONE\ntwo\nthree\n", "one\ntwo\nthree\ntyped\n")).toBe("ONE\ntwo\nthree\ntyped\n");
  });
  test("an edit of the same lines: refused", () => {
    expect(mergedWrite(base, "ONE\ntwo\nthree\n", "uno\ntwo\nthree\n")).toBeNull();
  });
});

describe("previewWrite", () => {
  const read = { path: "notes/a.md", rev: 1, text: "one\ntwo\nthree\n" };
  const make = (file: string) => file.replace("one", "ONE");
  test("the file is as it was read: the write", () => {
    expect(previewWrite("notes/a.md", 1, [], { rev: 1, text: read.text }, make)).toEqual({ text: "ONE\ntwo\nthree\n", merged: false });
  });
  test("edited since, the read in view: the write with the edit folded in", () => {
    expect(previewWrite("notes/a.md", 1, [read], { rev: 2, text: "one\ntwo\nthree\ntyped\n" }, make)).toEqual({ text: "ONE\ntwo\nthree\ntyped\n", merged: true });
  });
  test("edited since in the same lines: the server would refuse", () => {
    expect(previewWrite("notes/a.md", 1, [read], { rev: 2, text: "uno\ntwo\nthree\n" }, make)).toEqual({ problem: "overlap" });
  });
  test("edited since, the read gone from view or another note's: refused", () => {
    expect(previewWrite("notes/a.md", 1, [], { rev: 2, text: "uno\n" }, make)).toEqual({ problem: "moved" });
    expect(previewWrite("notes/a.md", 1, [{ ...read, path: "notes/b.md" }], { rev: 2, text: "uno\n" }, make)).toEqual({ problem: "moved" });
  });
  test("memory: a file not there yet takes the write; one made meanwhile is refused", () => {
    expect(previewWrite("agent/memory.md", 0, [], null, () => "a\n")).toEqual({ text: "a\n", merged: false });
    expect(previewWrite("agent/memory.md", 0, [], { rev: 1, text: "b\n" }, () => "a\n")).toEqual({ problem: "overlap" });
  });
});
