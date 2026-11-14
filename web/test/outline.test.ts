// A note's outline: what the contents rail draws (src/editor/outline.ts).
import { expect, test } from "bun:test";
import { parse } from "../src/editor/markdown";
import { outlineOf, sameOutline } from "../src/editor/outline";

const NOTE = `Words before any heading.

# Days

One fixed thing a day.

The rest is walking.

## Day 1

###

> ## Quoted, not a section

- a list under Day 1

# Packing`;

test("headings in order, each with the words under it", () => {
  expect(outlineOf(parse(NOTE)).map(({ level, title, lead }) => ({ level, title, lead }))).toEqual([
    { level: 1, title: "Days", lead: "One fixed thing a day. The rest is walking." },
    { level: 2, title: "Day 1", lead: "" },
    { level: 1, title: "Packing", lead: "" },
  ]);
});

test("an empty heading closes the section before it, and is not listed", () => {
  // Day 1's words stop at the empty heading: the quote and the list after it are under no listed heading
  expect(outlineOf(parse(NOTE))[1].lead).toBe("");
});

test("a heading's place is where it starts in the document", () => {
  const doc = parse(NOTE);
  for (const item of outlineOf(doc)) expect(doc.nodeAt(item.pos)?.textContent).toBe(item.title);
});

test("the lead is cut short", () => {
  const [item] = outlineOf(parse(`# Long\n\n${"word ".repeat(200)}`));
  expect(item.lead.length).toBe(160);
});

test("an outline whose headings only moved draws the same", () => {
  const a = outlineOf(parse(NOTE)), b = outlineOf(parse(`More words.\n\n${NOTE}`));
  expect(sameOutline(a, b)).toBe(true);
  expect(sameOutline(a, outlineOf(parse(NOTE.replace("# Packing", "## Packing"))))).toBe(false);
});
