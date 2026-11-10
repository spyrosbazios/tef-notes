// The slash menu's matching and the `/query` it finds before the cursor.
import { describe, expect, test } from "bun:test";
import { EditorState, TextSelection } from "prosemirror-state";
import { parse } from "../src/editor/markdown";
import { slashAt, slashMatches } from "../src/editor/slash";

const at = (md: string, offset: number) => {
  const doc = parse(md), state = EditorState.create({ doc });
  return slashAt(state.apply(state.tr.setSelection(TextSelection.create(doc, offset))));
};

describe("slash menu", () => {
  test("matches by any word's start", () => {
    expect(slashMatches("div").map((i) => i.name)).toEqual(["rule"]);
    expect(slashMatches("h2").map((i) => i.name)).toEqual(["heading2"]);
    expect(slashMatches("list").map((i) => i.name)).toEqual(["bulletList", "orderedList", "taskList"]);
    expect(slashMatches("zzz")).toEqual([]);
  });
  test("finds the query at a line's start or after a space", () => {
    expect(at("/bul", 5)).toEqual({ from: 1, query: "bul" });
    expect(at("hi /", 5)).toEqual({ from: 4, query: "" });
    expect(at("a/b", 4)).toBeNull();
    expect(at("/a b", 5)).toBeNull();
  });
});
