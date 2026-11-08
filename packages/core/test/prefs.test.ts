import { describe, expect, test } from "bun:test";
import { DEFAULT_PREFS, movedTab, prefsOf, shownTabs } from "../src/prefs";

describe("prefsOf", () => {
  test("nothing is the defaults", () => {
    expect(prefsOf(undefined)).toEqual(DEFAULT_PREFS);
    expect(prefsOf("junk")).toEqual(DEFAULT_PREFS);
  });
  test("keeps what is valid, drops the rest", () => {
    const p = prefsOf({ theme: "nope", tabs: ["ask", "ask", "bogus", "home"], hidden: ["settings", "tasks"], start: "today",
      notes: { grouped: true, collapsed: ["a", 1, "a"], sort: "created" }, agent: { model: "", effort: "deep", unasked: "yes" } });
    expect(p.theme).toBe(DEFAULT_PREFS.theme);
    expect(p.tabs).toEqual(["ask", "home", "tasks", "settings"]);
    expect(p.hidden).toEqual(["tasks"]);
    expect(p.start).toBe("today");
    expect(p.notes).toEqual({ grouped: true, collapsed: ["a"], sort: "created" });
    expect(p.agent).toEqual({ effort: "deep", unasked: false });
  });
});

test("shownTabs and movedTab", () => {
  expect(shownTabs({ tabs: ["ask", "home", "tasks", "settings"], hidden: ["tasks"] })).toEqual(["ask", "home", "settings"]);
  expect(movedTab(["home", "tasks", "ask", "settings"], "ask", -1)).toEqual(["home", "ask", "tasks", "settings"]);
  expect(movedTab(["home", "tasks"], "home", -1)).toEqual(["home", "tasks"]);
});
