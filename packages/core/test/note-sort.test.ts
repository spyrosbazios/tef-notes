import { describe, expect, it } from "bun:test";
import { isNoteSort, sortNotes, type Sortable } from "../src/note-sort";

const n = (path: string, created: string, updated: number, pinned = false): Sortable => ({ path, created, updated, pinned });
const paths = (ns: readonly Sortable[]) => ns.map((x) => x.path);

describe("sortNotes", () => {
  const a = n("notes/20260101-0900-a.md", "2026-01-01", 3), b = n("notes/20260201-0900-b.md", "2026-02-01", 2);
  it("hands the list back as it is by last edit, and never reorders it", () => {
    const source = [a, b];
    expect(sortNotes(source, "updated", (x) => x)).toBe(source);
    expect(paths(sortNotes(source, "created", (x) => x))).toEqual([b.path, a.path]);
    expect(paths(sortNotes(source, "created-asc", (x) => x))).toEqual([a.path, b.path]);
    expect(paths(sortNotes(source, "updated-asc", (x) => x))).toEqual([b.path, a.path]);
    expect(source).toEqual([a, b]);
  });
  it("keeps pinned notes first, and same-day notes follow the sort's direction by path", () => {
    const p = n("notes/20260101-0900-p.md", "2026-01-01", 1, true);
    const early = n("notes/20260301-0800-e.md", "2026-03-01", 2), late = n("notes/20260301-1700-l.md", "2026-03-01", 3);
    const source = [p, late, early];
    expect(paths(sortNotes(source, "created", (x) => x))).toEqual([p.path, late.path, early.path]);
    expect(paths(sortNotes(source, "created-asc", (x) => x))).toEqual([p.path, early.path, late.path]);
    expect(paths(sortNotes(source, "updated-asc", (x) => x))).toEqual([p.path, early.path, late.path]);
  });
  it("reads ISO times as well as epoch ms", () => {
    const x = { ...a, updated: "2026-03-01 10:00:00Z" }, y = { ...b, updated: "2026-02-01 10:00:00Z" };
    expect(paths(sortNotes([x, y], "updated-asc", (s) => s))).toEqual([y.path, x.path]);
  });
  it("knows its sorts", () => {
    expect(isNoteSort("created-asc")).toBe(true);
    expect(isNoteSort("title")).toBe(false);
  });
});
