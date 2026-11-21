// The masonry's tiles on screen, by id: a tile changing column replaces itself, and two masonries never hide each other's.
import { expect, test } from "bun:test";
import { OnScreen } from "@/lib/masonry";

test("a tile arriving while its id is on screen is moving: it replaces the one leaving", () => {
  const tiles = new OnScreen<string>();
  expect(tiles.has("a")).toBe(false);
  const first = tiles.arrive("a", "col1");
  expect(first.replaced).toEqual([]);
  expect(tiles.has("a")).toBe(true);
  expect(tiles.arrive("a", "col2").replaced).toEqual(["col1"]);
  first.leave();
  expect(tiles.has("a")).toBe(true);
});

test("the id goes once every tile with it has left", () => {
  const tiles = new OnScreen<string>();
  const a = tiles.arrive("a", "x"), b = tiles.arrive("a", "y");
  a.leave();
  b.leave();
  expect(tiles.has("a")).toBe(false);
  expect(tiles.arrive("a", "z").replaced).toEqual([]);
});

test("each masonry has its own: the same note in two chat answers hides neither", () => {
  const one = new OnScreen<string>(), two = new OnScreen<string>();
  one.arrive("notes/a.md", "first answer");
  expect(two.has("notes/a.md")).toBe(false);
  expect(two.arrive("notes/a.md", "second answer").replaced).toEqual([]);
});
