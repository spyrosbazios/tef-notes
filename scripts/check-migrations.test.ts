import { expect, test } from "bun:test";
import { problems } from "./check-migrations";

test("a new migration sharing a timestamp is refused", () => {
  expect(problems(["1795300000_a.js", "1795300000_b.js"])).toEqual(["timestamp 1795300000 is used by 1795300000_a.js, 1795300000_b.js: give the new one its own"]);
});

test("the pairs applied before the check stay allowed, and unique names pass", () => {
  expect(problems(["1792500000_pdf.js", "1792500000_tags.js", "1795300000_x.js", "1795300001_y.js"])).toEqual([]);
});

test("a name off the pattern is refused", () => {
  expect(problems(["179530000_short.js", "1795300000-dash.js"])).toHaveLength(2);
});
