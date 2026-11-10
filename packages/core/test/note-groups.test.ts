import { describe, expect, it } from "bun:test";
import { flipped, groupNotes, NO_TAG } from "../src/note-groups";

const n = (path: string, ...tags: string[]) => ({ path, tags });

describe("groupNotes", () => {
  const notes = [n("a", "home", "ideas"), n("b"), n("c", "Ideas"), n("d", "home")];
  it("puts a note under each of its tags, in list order, and the untagged last", () => {
    const g = groupNotes(notes, ["ideas", "home", "empty"]);
    expect(g.map((x) => [x.tag, x.notes.map((y) => y.path)])).toEqual([["ideas", ["a", "c"]], ["home", ["a", "d"]], [NO_TAG, ["b"]]]);
  });
  it("keeps just the chosen groups with `only`", () => {
    expect(groupNotes(notes, ["ideas", "home"], ["HOME"]).map((x) => x.tag)).toEqual(["home"]);
    expect(groupNotes(notes, ["ideas", "home"], [NO_TAG]).map((x) => x.tag)).toEqual([NO_TAG]);
    expect(groupNotes(notes, ["ideas", "home"], ["home", NO_TAG]).map((x) => x.tag)).toEqual(["home", NO_TAG]);
  });
});

describe("flipped", () => {
  it("flips a name in a set", () => {
    expect(flipped(["a"], "A")).toEqual([]);
    expect(flipped(["a"], "b")).toEqual(["a", "b"]);
  });
});
