import { expect, test } from "bun:test";
import { following } from "@/hooks/stick";

test("any move up is the reader leaving, however small", () => {
  expect(following(true, 500, 495, 5)).toBe(false);
  expect(following(true, 500, 200, 300)).toBe(false);
});

test("a glide down, still far from the end, keeps following", () => {
  expect(following(true, 500, 620, 300)).toBe(true);
});

test("a reader who left follows again only by scrolling down to near the end", () => {
  expect(following(false, 200, 260, 300)).toBe(false);
  expect(following(false, 200, 200, 40)).toBe(false);
  expect(following(false, 200, 460, 40)).toBe(true);
});

test("clamped to the end by shorter content is still following", () => {
  expect(following(true, 500, 420, 0)).toBe(true);
});
