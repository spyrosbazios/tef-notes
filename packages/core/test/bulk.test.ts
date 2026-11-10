import { describe, expect, it } from "bun:test";
import { archivePatch, between, colorPatch, pinPatch, tagChange, tagState, tagUnion, toggled } from "../src/bulk";

const n = (pinned: boolean) => ({ pinned });

describe("flag patches", () => {
  it("unpin when all are pinned, else pin", () => {
    expect(pinPatch([n(true), n(true)])).toEqual({ pinned: false });
    expect(pinPatch([n(true), n(false)])).toEqual({ pinned: true });
    expect(pinPatch([n(false)])).toEqual({ pinned: true });
  });
  it("a colour tints every card; null takes it off", () => {
    expect(colorPatch("pink")).toEqual({ color: "pink" });
    expect(colorPatch(null)).toEqual({ color: null });
  });
});

describe("tags across notes", () => {
  const lists = [["home", "Work"], ["work"], []];
  it("says whether a tag is on all, some or none", () => {
    expect(tagState(lists, "WORK")).toBe("some");
    expect(tagState(lists, "home")).toBe("some");
    expect(tagState(lists, "x")).toBe("none");
    expect(tagState([["a"], ["A"]], "a")).toBe("all");
  });
  it("adds a partial tag everywhere and removes a full one", () => {
    expect(tagChange(lists, "work")).toEqual({ add: ["work"], remove: [] });
    expect(tagChange([["a"], ["A"]], "a")).toEqual({ add: [], remove: ["a"] });
  });
  it("unions the names", () => {
    expect(tagUnion(lists)).toEqual(["home", "Work"]);
  });
});

describe("selection", () => {
  it("toggles", () => {
    expect(toggled(["a", "b"], "a")).toEqual(["b"]);
    expect(toggled(["a"], "c")).toEqual(["a", "c"]);
  });
  it("ranges either way round from the anchor", () => {
    const o = ["a", "b", "c", "d"];
    expect(between(o, "b", "d")).toEqual(["b", "c", "d"]);
    expect(between(o, "d", "b")).toEqual(["b", "c", "d"]);
    expect(between(o, undefined, "c")).toEqual(["c"]);
    expect(between(o, "x", "c")).toEqual(["c"]);
    expect(between(o, "a", "z")).toEqual([]);
  });
  it("unarchives when all are archived, else archives and unpins", () => {
    const a = (archived: boolean) => ({ archived });
    expect(archivePatch([a(true), a(true)])).toEqual({ archived: false });
    expect(archivePatch([a(true), a(false)])).toEqual({ archived: true, pinned: false });
  });
});
