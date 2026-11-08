import { describe, expect, it, test } from "bun:test";
import { DEFAULT_PREFS, movedTab, NEW_CHAT_IDLE_MS, newChatDue, prefsOf, shownTabs } from "../src/prefs";

describe("prefsOf", () => {
  test("nothing is the defaults", () => {
    expect(prefsOf(undefined)).toEqual(DEFAULT_PREFS);
    expect(prefsOf("junk")).toEqual(DEFAULT_PREFS);
  });
  test("keeps what is valid, drops the rest", () => {
    const p = prefsOf({ theme: "nope", tabs: ["ask", "ask", "bogus", "home"], hidden: ["settings", "tasks"], start: "today",
      notes: { grouped: true, collapsed: ["a", 1, "a"], sort: "created" }, agent: { model: "", effort: "deep", unasked: "yes" } });
    expect(p.theme).toBe(DEFAULT_PREFS.theme);
    expect(p.tabs).toEqual(["ask", "home", "tasks", "notes", "settings"]);
    expect(p.hidden).toEqual(["tasks", "notes"]);
    expect(p.start).toBe("today");
    expect(prefsOf({ lens: "abc" }).lens).toBe("abc");
    expect(prefsOf({ lens: "" }).lens).toBeUndefined();
    expect(p.notes).toEqual({ grouped: true, collapsed: ["a"], sort: "created" });
    expect(p.agent).toEqual({ effort: "deep", unasked: false, newChat: "app" });
  });
});

test("Notes: off by default, kept once placed", () => {
  expect(prefsOf({}).hidden).toEqual(["notes"]);
  expect(prefsOf({ tabs: ["notes", "home"], hidden: [] }).hidden).toEqual([]);
});

test("task lists", () => {
  expect(prefsOf({ homeList: "inbox", tasksList: "nope" })).toMatchObject({ homeList: "inbox", tasksList: "today" });
});

test("shownTabs and movedTab", () => {
  expect(shownTabs({ tabs: ["ask", "home", "tasks", "settings"], hidden: ["tasks"] })).toEqual(["ask", "home", "settings"]);
  expect(movedTab(["home", "tasks", "ask", "settings"], "ask", "home", false)).toEqual(["ask", "home", "tasks", "settings"]);
  expect(movedTab(["home", "tasks", "ask", "settings"], "home", "ask", true)).toEqual(["tasks", "ask", "home", "settings"]);
  expect(movedTab(["home", "tasks"], "home", "home", true)).toEqual(["home", "tasks"]);
});

describe("newChatDue", () => {
  it("follows the setting", () => {
    expect(newChatDue("open", false, Date.now(), Date.now())).toBe(true);
    expect(newChatDue("app", false, 0, 1)).toBe(false);
    expect(newChatDue("app", true, 0, 1)).toBe(true);
    expect(newChatDue("idle", true, 0, NEW_CHAT_IDLE_MS - 1)).toBe(false);
    expect(newChatDue("idle", false, 0, NEW_CHAT_IDLE_MS)).toBe(true);
    expect(newChatDue("never", true, 0, 1e12)).toBe(false);
  });
  it("reads an unknown or missing value as after leaving the app", () => {
    expect(prefsOf({}).agent.newChat).toBe("app");
    expect(prefsOf({ agent: { newChat: "x" } }).agent.newChat).toBe("app");
    expect(prefsOf({ agent: { newChat: "idle" } }).agent.newChat).toBe("idle");
  });
});
