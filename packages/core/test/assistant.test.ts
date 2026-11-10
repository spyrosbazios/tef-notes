import { describe, expect, it } from "bun:test";
import { ASK, choiceFrom, choiceOutput, chosenOf, contextOf, goView, isAskTool, isSelectionTool, isUiTool, LIMITS, SELECTION_TOOL_NAMES, UI_TOOL_NAMES, uiToolsFor, viewFrom } from "../src/assistant";
import { label } from "../src/agent";

describe("viewFrom", () => {
  it("takes a plain view as it is, a tag with its tag", () => {
    expect(viewFrom("today")).toEqual({ kind: "today" });
    expect(viewFrom("tag", { tag: " #home " })).toEqual({ kind: "tag", tag: "home" });
  });
  it("refuses an unknown kind and a tag without a tag", () => {
    expect(viewFrom("elsewhere")).toBeNull();
    expect(viewFrom(7)).toBeNull();
    expect(viewFrom("tag", {})).toBeNull();
  });
});

describe("contextOf", () => {
  it("reads a full context", () => {
    const raw = {
      view: { kind: "tag", tag: "home" }, note: { path: "notes/20261101-a.md", title: "A", rev: 3 },
      task: { id: "t1", title: "Buy milk" }, selection: "some words", filter: "milk",
    };
    expect(contextOf(raw)).toEqual(raw as never);
  });
  it("is undefined without a readable view: there is no context then", () => {
    for (const raw of [null, "x", [], {}, { view: "today" }, { view: { kind: "nope" } }, { view: { kind: "tag" } }]) expect(contextOf(raw)).toBeUndefined();
  });
  it("drops a piece that doesn't fit and keeps the rest", () => {
    const c = contextOf({
      client: "tablet", view: { kind: "notes" }, note: { path: "../etc/passwd", title: "x" }, task: { id: "no spaces", title: "t" },
      selection: "   ", filter: 5,
    });
    expect(c).toEqual({ view: { kind: "notes" } });
  });
  it("keeps a note without a usable rev, and a title on one line", () => {
    expect(contextOf({ view: { kind: "notes" }, note: { path: "notes/a.md", title: "  two\n lines  ", rev: -1 } })?.note).toEqual({ path: "notes/a.md", title: "two lines" });
    expect(contextOf({ view: { kind: "notes" }, note: { path: "notes/a.md", rev: 1.5 } })?.note).toEqual({ path: "notes/a.md", title: "" });
  });
  it("bounds every text, and keeps the selection's newlines", () => {
    const c = contextOf({ view: { kind: "notes" }, selection: `a\nb${"x".repeat(LIMITS.selection)}`, filter: "y".repeat(500), task: { id: "t", title: "z".repeat(500) } })!;
    expect(c.selection!.length).toBe(LIMITS.selection);
    expect(c.selection!.startsWith("a\nb")).toBe(true);
    expect(c.filter!.length).toBe(LIMITS.filter);
    expect(c.task!.title.length).toBe(LIMITS.title);
  });
});

describe("the UI tools", () => {
  it("are offered only with a context, and each has a label", () => {
    expect(uiToolsFor(undefined)).toEqual([]);
    expect(uiToolsFor({ view: { kind: "home" } })).toEqual(UI_TOOL_NAMES.filter((n) => !isSelectionTool(n)));
    for (const n of UI_TOOL_NAMES) expect(label(n)).not.toBe(n);
    expect(isUiTool("open_note")).toBe(true);
    expect(isUiTool("read_note")).toBe(false);
  });
  it("go_view turns into a view, null for a tag without a tag", () => {
    expect(goView({ view: "inbox" })).toEqual({ kind: "inbox" });
    expect(goView({ view: "tag", tag: "home" })).toEqual({ kind: "tag", tag: "home" });
    expect(goView({ view: "tag" })).toBeNull();
  });
});

describe("the selection", () => {
  const note = { path: "notes/20261101-a.md", title: "A" };
  it("is editable only with words selected in an open note", () => {
    expect(contextOf({ view: { kind: "home" }, note, selection: "some words", editable: true })?.editable).toBe(true);
    expect(contextOf({ view: { kind: "home" }, selection: "some words", editable: true })?.editable).toBeUndefined();
    expect(contextOf({ view: { kind: "home" }, note, selection: "  ", editable: true })?.editable).toBeUndefined();
    expect(contextOf({ view: { kind: "home" }, note, selection: "x", editable: "yes" })?.editable).toBeUndefined();
  });
  it("offers its tools only then, beside every other UI tool", () => {
    expect(uiToolsFor({ view: { kind: "home" }, note, selection: "x", editable: true })).toEqual(UI_TOOL_NAMES);
    for (const n of SELECTION_TOOL_NAMES) expect(isUiTool(n) && isSelectionTool(n)).toBe(true);
    expect(isSelectionTool("open_note")).toBe(false);
  });
});

describe("ask_choice", () => {
  const opt = (id: string, label = id) => ({ id, label });
  it("is a UI tool the owner answers, not the app", () => {
    expect(isUiTool("ask_choice")).toBe(true);
    expect(isAskTool("ask_choice")).toBe(true);
    for (const n of UI_TOOL_NAMES.filter((x) => x !== "ask_choice")) expect(isAskTool(n)).toBe(false);
  });
  it("reads a question out of a call's input, trimmed, one line each, with a hint and multi only when set", () => {
    expect(choiceFrom({ question: "  When?\n", options: [{ id: " today ", label: "Today", hint: " this evening\n " }, opt("tomorrow", "Tomorrow")], multi: true }))
      .toEqual({ question: "When?", options: [{ id: "today", label: "Today", hint: "this evening" }, opt("tomorrow", "Tomorrow")], multi: true });
    expect(choiceFrom({ question: "q", options: [opt("a"), opt("b")], multi: "yes" })).toEqual({ question: "q", options: [opt("a"), opt("b")] });
  });
  it("is null until there is a question and two usable options (a call's input streams in part by part)", () => {
    for (const x of [null, "q", {}, { question: "q" }, { question: "q", options: [opt("a")] }, { question: "", options: [opt("a"), opt("b")] },
      { question: "q", options: [opt("a"), { id: "", label: "x" }, { id: "c", label: " " }, 3, null] }, { question: "q", options: [opt("a"), opt("a", "again")] }])
      expect(choiceFrom(x)).toBeNull();
  });
  it("keeps the first ASK.max options and cuts what is too long", () => {
    const many = Array.from({ length: 9 }, (_, i) => opt(`o${i}`));
    expect(choiceFrom({ question: "q", options: many })?.options).toHaveLength(ASK.max);
    expect(choiceFrom({ question: "q".repeat(500), options: [opt("a", "l".repeat(200)), opt("b")] })).toMatchObject({ question: "q".repeat(ASK.question), options: [{ label: "l".repeat(ASK.label) }, {}] });
  });
  it("is answered with the ids chosen, read back from the finished call", () => {
    expect(choiceOutput(["a", "b"])).toEqual({ chosen: ["a", "b"] });
    expect(chosenOf({ chosen: ["a"] })).toEqual(["a"]);
    for (const x of [{ error: "no" }, { chosen: "a" }, { chosen: [1] }, null, "a"]) expect(chosenOf(x)).toBeNull();
  });
});
