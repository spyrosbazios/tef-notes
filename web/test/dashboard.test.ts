import { expect, test } from "bun:test";
import { columnCount, deal } from "@/lib/masonry";
import { matches } from "@/lib/search";
import { withNote } from "@/services/notes";
const note = (id: string, title: string, created: string, updated: string, tags: string[]) => withNote({
  rec: id, path: `notes/${id}.md`, rev: 1, kind: "note", updated,
  text: `---\ntitle: ${title}\ncreated: ${created}\ntags: [${tags.join(", ")}]\n---\nDoor codes`,
});
test("search matches a note's text, not only its title", () => {
  expect(matches("door")(note("a", "Zebra", "2026-01-01", "2026-03-01", ["Home"]))).toBe(true);
});
test("the masonry reads by rows: tiles dealt across the columns in order", () => {
  expect(deal([1, 2, 3, 4, 5], 3)).toEqual([[1, 4], [2, 5], [3]]);
  expect(columnCount(996, 16)).toBe(4);     // 4 x 240 + 3 x 12, as CSS columns-[15rem] gap-3 counts
  expect(columnCount(995, 16)).toBe(3);
  expect(columnCount(200, 16)).toBe(1);
  expect(columnCount(328, 16)).toBe(2);     // a phone: two narrow columns, as the Android app draws
  expect(columnCount(287, 16)).toBe(1);
});
