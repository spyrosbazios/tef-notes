// What a body from elsewhere changed: the words that are new, and nothing of what stayed.
import { describe, expect, test } from "bun:test";
import { EditorState } from "prosemirror-state";
import { changedRanges, fresh, freshRanges, tinted } from "../src/editor/fresh";
import { parse } from "../src/editor/markdown";

/** The text of each range `to` has over `from`. */
const news = (from: string, to: string) => {
  const doc = parse(to);
  return changedRanges(parse(from), doc).map(([a, b]) => doc.textBetween(a, b, "|"));
};

describe("what a body from elsewhere changed", () => {
  test("nothing, when it says the same", () => {
    expect(news("one\n\ntwo\n", "one\n\ntwo\n")).toEqual([]);
  });

  test("a block added at the end, in the middle, at the start", () => {
    expect(news("one\n\ntwo\n", "one\n\ntwo\n\nthree\n")).toEqual(["three"]);
    expect(news("one\n\nthree\n", "one\n\ntwo\n\nthree\n")).toEqual(["two"]);
    expect(news("two\n", "# Title\n\ntwo\n")).toEqual(["Title"]);
  });

  test("of a paragraph that changed, only the words that did", () => {
    expect(news("Buy eggs today\n", "Buy fresh eggs today\n")).toEqual(["fresh "]);
    expect(news("Call the bank\n", "Call the bank on Monday\n")).toEqual([" on Monday"]);
    expect(news("a\n", "aa\n")).toEqual(["a"]);
  });

  test("an item added to a list is that item, not the list", () => {
    expect(news("- milk\n- eggs\n", "- milk\n- eggs\n- bread\n")).toEqual(["bread"]);
  });

  test("several places at once, each its own range", () => {
    expect(news("one\n\ntwo\n\nthree\n\nfour\n", "one\n\nTWO\n\nthree\n\nfour\n\nfive\n")).toEqual(["TWO", "five"]);
  });

  test("a block of another kind in its place is new whole; words that only went leave nothing", () => {
    expect(news("one\n\ntwo\n", "one\n\n## two\n")).toEqual(["two"]);
    expect(news("one\n\ntwo\n\nthree\n", "one\n\nthree\n")).toEqual([]);
    expect(news("Buy fresh eggs\n", "Buy eggs\n")).toEqual([]);
  });

  test("a rewrite with nothing in common is all new", () => {
    expect(news("one\n\ntwo\n", "alpha\n\nbeta\n\ngamma\n")).toEqual(["alpha", "beta", "gamma"]);
  });
});

describe("the tint", () => {
  test("follows the edits made while it shows, and goes when cleared", () => {
    const doc = parse("one\n\ntwo\n");
    let state = EditorState.create({ doc, plugins: [fresh] });
    state = state.apply(tinted(state.tr, changedRanges(parse("one\n"), doc)));
    const text = () => freshRanges(state).map(([a, b]) => state.doc.textBetween(a, b));
    expect(text()).toEqual(["two"]);
    state = state.apply(state.tr.insertText("zero ", 1));
    expect(text()).toEqual(["two"]);
    state = state.apply(tinted(state.tr, []));
    expect(text()).toEqual([]);
  });
});
