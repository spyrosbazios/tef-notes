// The URL's query as the router reads and writes it (src/lib/route-search.ts), and the places it names (src/lib/nav.ts).
import { describe, expect, test } from "bun:test";
import { homeSearch, parseSearch, settingsSearch, shareSearch, shellSearch, stringifySearch } from "@/lib/route-search";
import { linkOf, noteLink, taskInDrawer, taskLink, viewOf } from "@/lib/nav";

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

  test("the archive: `archived=1`, anything else dropped", () => {
    expect(homeSearch({ archived: "1", tags: "a" })).toEqual({ tags: ["a"], archived: "1" });
    expect(homeSearch({ archived: "yes" })).toEqual({ tags: undefined, archived: undefined });
  });

  test("the shell's open task and note are ids, a number's digits kept", () => {
    expect(shellSearch({ t: "abc" })).toEqual({ t: "abc", note: undefined });
    expect(shellSearch({ t: 123 }).t).toBe("123");
    expect(shellSearch({ t: "" }).t).toBeUndefined();
    expect(shellSearch({ t: { x: 1 } }).t).toBeUndefined();
    expect(shellSearch({ note: "20261102-garage" })).toEqual({ note: "20261102-garage", t: undefined });
    expect(shellSearch({})).toEqual({ note: undefined, t: undefined });
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
    expect(viewOf("/notes", { tags: ["a"], archived: true })).toEqual({ kind: "notes", tags: ["a"], archived: true });
    expect(linkOf({ kind: "notes", archived: true })).toEqual({ to: "/notes", search: { tags: undefined, archived: "1", t: undefined, note: undefined } });
  });

  test("a view is a typed link, with its open task and note", () => {
    expect(linkOf({ kind: "home", tags: ["a"] })).toEqual({ to: "/", search: { tags: ["a"], archived: undefined, t: undefined, note: undefined } });
    expect(linkOf({ kind: "home" }, { task: "t1" })).toEqual({ to: "/", search: { tags: undefined, archived: undefined, t: "t1", note: undefined } });
    expect(linkOf({ kind: "today" }, { task: "t1" })).toEqual({ to: "/today", search: { t: "t1", note: undefined } });
    expect(linkOf({ kind: "settings", section: "agent" })).toEqual({ to: "/settings", search: { section: "agent", t: undefined, note: undefined } });
  });

  test("a note lies over the screen it was opened from, the open task stepping aside; from outside the shell, over Home", () => {
    expect(noteLink("n1", { kind: "today" })).toEqual({ to: "/today", search: { t: undefined, note: "n1" } });
    expect(noteLink("n1", { kind: "home", tags: ["a"] })).toEqual({ to: "/", search: { tags: ["a"], archived: undefined, t: undefined, note: "n1" } });
    expect(noteLink("n1", null)).toEqual({ to: "/", search: { tags: undefined, archived: undefined, t: undefined, note: "n1" } });
  });

  test("a task opens over where the app is: the first is a step marked to go back from, the next takes its place", () => {
    const first = taskLink("t1", { view: { kind: "home", tags: ["a"] }, note: "n1" });
    expect(first).toMatchObject({ to: "/", search: { tags: ["a"], t: "t1", note: "n1" }, replace: false });
    expect(first.state({ ask: true })).toEqual({ ask: true, taskFrom: true });
    const next = taskLink("t2", { view: { kind: "today" }, task: "t1" });
    expect(next).toMatchObject({ to: "/today", search: { t: "t2" }, replace: true });
    expect(next.state({ taskFrom: true })).toEqual({ taskFrom: true });
    expect(next.state({})).toEqual({ taskFrom: false });
  });

  test("the open task is a drawer, but beside its list in a wide window with no note over it", () => {
    expect(taskInDrawer({ view: { kind: "home" } }, false)).toBe(true);
    expect(taskInDrawer({ view: { kind: "today" } }, false)).toBe(false);
    expect(taskInDrawer({ view: { kind: "today" } }, true)).toBe(true);
    expect(taskInDrawer({ view: { kind: "today" }, note: "n1" }, false)).toBe(true);
  });
});
