// The URL's query as the router reads and writes it (src/lib/route-search.ts), and the places it names (src/lib/nav.ts).
import { describe, expect, test } from "bun:test";
import { homeSearch, listSearch, parseSearch, settingsSearch, shareSearch, shellSearch, stringifySearch } from "@/lib/route-search";
import { linkOf, noteLink, viewOf } from "@/lib/nav";

describe("the query", () => {
  test("reads every value as a string", () => {
    expect(parseSearch("?t=abc123&tags=a,b&shared=1")).toEqual({ t: "abc123", tags: "a,b", shared: "1" });
    expect(parseSearch("")).toEqual({});
    expect(parseSearch("note=20261102-garage")).toEqual({ note: "20261102-garage" });
  });

  test("writes plain values, lists comma-joined, and leaves out what is empty", () => {
    expect(stringifySearch({ t: "abc", note: undefined })).toBe("?t=abc");
    expect(stringifySearch({ tags: ["work", "home"] })).toBe("?tags=work,home");
    expect(stringifySearch({ tags: [], section: "" })).toBe("");
    expect(stringifySearch({})).toBe("");
  });

  test("encodes each item, so a tag's spaces and accents survive the trip", () => {
    const q = stringifySearch({ tags: ["σπίτι", "to do"] });
    expect(q).toBe(`?tags=${encodeURIComponent("σπίτι")},${encodeURIComponent("to do")}`);
    expect(homeSearch(parseSearch(q))).toEqual({ tags: ["σπίτι", "to do"] });
  });

  test("round-trips every route's search", () => {
    for (const s of [{ t: "x1" }, { note: "20261102-garage", t: "x1" }, { tags: ["a", "b"] }, { section: "agent" }]) {
      expect(parseSearch(stringifySearch(s))).toEqual(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v])));
    }
  });
});

describe("the validators", () => {
  test("Home's tags: a comma list, blanks dropped, none when empty", () => {
    expect(homeSearch({ tags: "a,,b, " })).toEqual({ tags: ["a", "b"] });
    expect(homeSearch({ tags: ["a"] })).toEqual({ tags: ["a"] });
    expect(homeSearch({ tags: "" })).toEqual({ tags: undefined });
    expect(homeSearch({})).toEqual({ tags: undefined });
  });

  test("a task list's open task and the shell's note are ids, a number's digits kept", () => {
    expect(listSearch({ t: "abc" })).toEqual({ t: "abc" });
    expect(listSearch({ t: 123 })).toEqual({ t: "123" });
    expect(listSearch({ t: "" })).toEqual({ t: undefined });
    expect(listSearch({ t: { x: 1 } })).toEqual({ t: undefined });
    expect(shellSearch({ note: "20261102-garage" })).toEqual({ note: "20261102-garage" });
    expect(shellSearch({})).toEqual({ note: undefined });
  });

  test("Settings takes only a section it has", () => {
    expect(settingsSearch({ section: "agent" })).toEqual({ section: "agent" });
    expect(settingsSearch({ section: "nope" })).toEqual({ section: undefined });
  });

  test("the share page takes 1 or err", () => {
    expect(shareSearch({ shared: "1" })).toEqual({ shared: "1" });
    expect(shareSearch({ shared: 1 })).toEqual({ shared: "1" });
    expect(shareSearch({ shared: "err" })).toEqual({ shared: "err" });
    expect(shareSearch({ shared: "x" })).toEqual({ shared: undefined });
  });
});

describe("places", () => {
  test("a path and its search are a view", () => {
    expect(viewOf("/")).toEqual({ kind: "home" });
    expect(viewOf("/", { tags: ["a"] })).toEqual({ kind: "home", tags: ["a"] });
    expect(viewOf("/today")).toEqual({ kind: "today" });
    expect(viewOf("/settings", { section: "tags" })).toEqual({ kind: "settings", section: "tags" });
    expect(viewOf("/elsewhere")).toEqual({ kind: "home" });
  });

  test("a view is a typed link, with its open task and note", () => {
    expect(linkOf({ kind: "home", tags: ["a"] })).toEqual({ to: "/", search: { tags: ["a"], note: undefined } });
    expect(linkOf({ kind: "today" }, { task: "t1" })).toEqual({ to: "/today", search: { t: "t1", note: undefined } });
    expect(linkOf({ kind: "settings", section: "agent" })).toEqual({ to: "/settings", search: { section: "agent", note: undefined } });
  });

  test("a note lies over the screen it was opened from, its task kept; from outside the shell, over Home", () => {
    expect(noteLink("n1", { view: { kind: "today" }, task: "t1" })).toEqual({ to: "/today", search: { t: "t1", note: "n1" } });
    expect(noteLink("n1", { view: { kind: "home", tags: ["a"] } })).toEqual({ to: "/", search: { tags: ["a"], note: "n1" } });
    expect(noteLink("n1", null)).toEqual({ to: "/", search: { tags: undefined, note: "n1" } });
  });
});
