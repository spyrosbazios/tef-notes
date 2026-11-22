import { describe, expect, test } from "bun:test";
import {
  BUILTINS, DEFAULT_PROMPTS, idsAt, ACTION_LIMITS, movedSlot, newActionId, placedAt, promptOf, promptProblem, promptsOf, ranOn,
  runMessage, runOf, runTitle, slotsOf,
} from "../src/note-actions";
import { DEFAULT_PREFS, patchPaths, prefsOf, withPatch } from "../src/prefs";

const mine = { id: "sum", label: "Summarise", icon: "summary", prompt: "Three bullets.", result: "answer" } as const;

describe("promptsOf", () => {
  test("nothing stored is the app's two; a stored list is the owner's, an empty one too", () => {
    expect(promptsOf(undefined)).toEqual([...DEFAULT_PROMPTS]);
    expect(promptsOf([])).toEqual([]);
    expect(promptsOf([mine])).toEqual([mine]);
  });
  test("drops what it can't use, and a second of the same id", () => {
    expect(promptsOf([mine, { ...mine, label: "Again" }, { id: "x" }, { ...mine, id: "pin" }, { ...mine, id: "Bad Id" }, "junk"])).toEqual([mine]);
  });
  test("an unknown icon or result falls back; the name is one line, cut to its limit", () => {
    expect(promptOf({ id: "a", label: "  Two\n words ", prompt: " do ", icon: "nope", result: "nuke" }))
      .toEqual({ id: "a", label: "Two words", prompt: "do", icon: "sparkles", result: "answer" });
    expect(promptOf({ id: "a", label: "x".repeat(99), prompt: "p" })?.label).toHaveLength(ACTION_LIMITS.label);
  });
  test("holds at most its limit", () => {
    expect(promptsOf(Array.from({ length: 40 }, (_, i) => ({ ...mine, id: `a${i}` })))).toHaveLength(ACTION_LIMITS.actions);
  });
});

test("newActionId: from the name, never a built-in's or one taken", () => {
  expect(newActionId("Checklist it!", [])).toBe("checklist-it");
  expect(newActionId("Tidy", ["tidy", "tidy-2"])).toBe("tidy-3");
  expect(newActionId("Pin", [])).toBe("pin-2");
  expect(newActionId("Σύνοψη", [])).toBe("action");
});

test("promptProblem", () => {
  expect(promptProblem({ label: "A", prompt: "b" })).toBeNull();
  expect(promptProblem({ label: " ", prompt: "b" })).toMatch(/name/);
  expect(promptProblem({ label: "A", prompt: "" })).toMatch(/prompt/);
  expect(promptProblem({ label: "A", prompt: "x".repeat(ACTION_LIMITS.prompt + 1) })).toMatch(/too long/);
});

describe("slotsOf", () => {
  test("a layout nobody set: its header, the rest in the menu", () => {
    const d = slotsOf(undefined, "desktop", DEFAULT_PROMPTS), p = slotsOf(undefined, "phone", DEFAULT_PROMPTS);
    expect(idsAt(d, "header")).toEqual(["attach", "pin", "tidy", "task"]);
    expect(idsAt(p, "header")).toEqual(["attach", "pin", "tidy"]);
    expect(d.map((s) => s.id).sort()).toEqual([...BUILTINS, "tidy", "task"].sort());
    expect(idsAt(slotsOf(undefined, "desktop", []), "header")).toEqual(["attach", "pin"]);
  });
  test("keeps the stored order and places, drops what is gone, adds what is new to the menu", () => {
    const s = slotsOf([{ id: "sum", place: "header" }, { id: "gone", place: "header" }, { id: "pin", place: "off" }, { id: "sum", place: "off" }], "phone", [mine]);
    expect(s.slice(0, 2)).toEqual([{ id: "sum", place: "header" }, { id: "pin", place: "off" }]);
    expect(idsAt(s, "menu")).toEqual(BUILTINS.filter((b) => b !== "pin"));
  });
  test("the header holds as many buttons as are pinned", () => {
    const s = slotsOf(BUILTINS.map((id) => ({ id, place: "header" })), "phone", []);
    expect(idsAt(s, "header")).toEqual([...BUILTINS]);
  });
});

test("placedAt moves one without a cap; movedSlot reorders", () => {
  const s = slotsOf(undefined, "phone", DEFAULT_PROMPTS);
  expect(idsAt(placedAt(s, "ask", "header"), "header")).toEqual(["attach", "pin", "tidy", "ask"]);
  expect(idsAt(placedAt(s, "pin", "off"), "off")).toEqual(["pin"]);
  expect(movedSlot(s, "tidy", "attach", false).map((x) => x.id).slice(0, 3)).toEqual(["tidy", "attach", "pin"]);
  expect(movedSlot(s, "tidy", "nope", false)).toEqual(s);
});

test("a run's message names the action and the note, and reads back", () => {
  const note = { path: "notes/a-1.md", title: "Meeting (Tue)" }, text = runMessage(mine, note);
  expect(text).toBe("Summarise, on my note “Meeting (Tue)” (notes/a-1.md): Three bullets.");
  expect(ranOn(text)).toEqual({ label: "Summarise", note, prompt: "Three bullets." });
  expect(ranOn("About my note “x” (notes/x.md): hi")).toBeNull();
  expect(runTitle(mine, { path: "notes/a-1.md", title: " " })).toBe("Summarise: a-1");
  expect(runOf({ id: "sum", note: "notes/a.md" })).toEqual({ id: "sum", note: "notes/a.md" });
  expect(runOf({ id: "sum", note: "agent/memory.md" })).toBeUndefined();
  expect(runOf({ id: "Bad", note: "notes/a.md" })).toBeUndefined();
});

describe("in the preferences", () => {
  test("defaults", () => {
    expect(DEFAULT_PREFS.noteActions).toEqual([...DEFAULT_PROMPTS]);
    expect(idsAt(DEFAULT_PREFS.desktop.noteHeader, "header")).toEqual(["attach", "pin", "tidy", "task"]);
  });
  test("the list is one value; a layout's header is its own field", () => {
    expect(patchPaths({ noteActions: [mine], phone: { noteHeader: [] } })).toEqual(["noteActions", "phone.noteHeader"]);
  });
  test("a deleted action leaves every header; a new one starts in the menu", () => {
    const p = withPatch(DEFAULT_PREFS, { noteActions: [DEFAULT_PROMPTS[1], mine] });
    expect(idsAt(p.desktop.noteHeader, "header")).toEqual(["attach", "pin", "task"]);
    expect(idsAt(p.phone.noteHeader, "header")).toEqual(["attach", "pin"]);
    expect(idsAt(p.phone.noteHeader, "menu")).toContain("sum");
    expect(prefsOf(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});
