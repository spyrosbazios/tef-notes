// Stored rows read back (src/rows.ts): a row of this build's shape comes back as it was, one lacking a field it may lack gets
// its empty value, and anything else is dropped.
import { describe, expect, test } from "bun:test";
import { linkRowOf, noteRowOf, taskRowOf } from "../src/rows";
import { freshNote, type LinkRow, type TaskRow } from "../src/sync";
import { newTask } from "../src/todo";

describe("stored rows", () => {
  test("a note row comes back as it was stored; one without its record id, path or text is dropped", () => {
    const row = { ...freshNote("r1", "notes/a.md", "text", 5), rev: 2, base: "text", pushed: 5, refused: "too long", tainted: true as const };
    expect(noteRowOf(structuredClone(row))).toEqual(row);
    expect(noteRowOf({ ...row, rec: null })).toBeUndefined();
    expect(noteRowOf({ ...row, path: 1 })).toBeUndefined();
    expect(noteRowOf({ ...row, text: undefined })).toBeUndefined();
    expect(noteRowOf(null)).toBeUndefined();
    expect(noteRowOf("notes/a.md")).toBeUndefined();
  });

  test("a note row lacking fields it may lack gets them empty", () => {
    expect(noteRowOf({ path: "notes/a.md", text: "t", rec: "r1", updated: 3 })).toEqual({
      path: "notes/a.md", text: "t", kind: "note", updated: 3, pushed: null, rec: "r1", rev: null, base: null,
      conflict_text: null, conflict_rev: null, lost: null, deleted: false,
    });
  });

  test("a task row comes back as stored; one whose task names another id is dropped", () => {
    const t = newTask("t1", { title: "x", tags: ["a"] });
    const row: TaskRow = { id: "t1", data: t, base: t, rev: 1, updated: 2, pushed: 2, deleted: false };
    expect(taskRowOf(structuredClone(row))).toEqual(row);
    expect(taskRowOf({ ...row, data: { ...t, id: "t2" } })).toBeUndefined();
    expect(taskRowOf({ ...row, data: "x" })).toBeUndefined();
    expect(taskRowOf({ ...row, base: undefined, rev: undefined })).toEqual({ ...row, base: null, rev: null });
  });

  test("a link row comes back as stored; one whose link isn't one is dropped", () => {
    const row: LinkRow = { link: { id: "l1", from: { type: "task", id: "t1" }, to: { type: "note", id: "r1" }, role: "about" }, pushed: null, deleted: true, refused: "no" };
    expect(linkRowOf(structuredClone(row))).toEqual(row);
    expect(linkRowOf({ ...row, link: { ...row.link, role: "other" } })).toBeUndefined();
    expect(linkRowOf({ ...row, link: { ...row.link, to: row.link.from } })).toBeUndefined();
    expect(linkRowOf({ ...row, link: { ...row.link, from: { type: "shot", id: "s" } } })).toBeUndefined();
  });
});
