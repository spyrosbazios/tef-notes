import { describe, expect, it, test } from "bun:test";
import { DEFAULT_PREFS, RAIL, everyPath, isPrefPath, movedTab, NEW_CHAT_IDLE_MS, newChatDue, patchPaths, prefAt, prefsOf, rebased, shownRail, shownTabs, withPatch } from "../src/prefs";

describe("prefsOf", () => {
  test("nothing is the defaults", () => {
    expect(prefsOf(undefined)).toEqual(DEFAULT_PREFS);
    expect(prefsOf("junk")).toEqual(DEFAULT_PREFS);
  });
  test("keeps what is valid, drops the rest", () => {
    const p = prefsOf({ theme: "nope", phone: { tabs: ["ask", "ask", "bogus", "home"], hidden: ["settings", "tasks"], start: "today" },
      notes: { grouped: true, collapsed: ["a", 1, "a"], sort: "created" }, agent: { model: "", effort: "deep", unasked: "yes" } });
    expect(p.theme).toBe(DEFAULT_PREFS.theme);
    expect(p.phone.tabs).toEqual(["ask", "home", "tasks", "notes", "talk", "settings"]);
    expect(p.phone.hidden).toEqual(["tasks", "notes", "talk"]);
    expect(p.phone.start).toBe("today");
    expect(prefsOf({ lens: "abc" }).lens).toBe("abc");
    expect(prefsOf({ lens: "" }).lens).toBeNull();
    expect(p.notes).toEqual({ grouped: true, collapsed: ["a"], sort: "created" });
    expect(p.agent).toEqual({ effort: "deep", unasked: false, newChat: "app" });
  });
  test("each layout keeps its own", () => {
    const p = prefsOf({ phone: { start: "inbox", homeList: "upcoming" }, desktop: { start: "notes", homeList: "nope", hidden: ["today", "bogus", "today"], known: RAIL } });
    expect(p.phone).toMatchObject({ start: "inbox", homeList: "upcoming" });
    expect(p.desktop).toEqual({ start: "notes", homeList: "today", hidden: ["today"], known: [...RAIL] });
  });
  test("the shape before layouts reads as defaults: the migration moved it (1794600000_prefs_layouts.js)", () => {
    expect(prefsOf({ start: "inbox", tabs: ["ask", "home"] }).phone).toEqual(DEFAULT_PREFS.phone);
  });
});

test("Notes and Talk: off by default, kept once placed", () => {
  expect(prefsOf({}).phone.hidden).toEqual(["notes", "talk"]);
  expect(prefsOf({ phone: { tabs: ["notes", "talk", "home"], hidden: [] } }).phone.hidden).toEqual([]);
  expect(prefsOf({}).desktop.hidden).toEqual(["notes", "talk"]);
  expect(prefsOf({ desktop: { hidden: [], known: RAIL } }).desktop.hidden).toEqual([]);
});

test("a screen new to a stored record starts hidden, whatever else it shows", () => {
  // A phone's bar that was saved before Talk existed: it knows its tabs, and Talk is not among them
  const old = { phone: { tabs: ["home", "tasks", "notes", "ask", "settings"], hidden: [] } };
  expect(prefsOf(old).phone.hidden).toEqual(["talk"]);
  expect(prefsOf(old).phone.tabs).toEqual(["home", "tasks", "notes", "ask", "settings", "talk"]);
  // A sidebar saved knowing every screen but Talk, Notes shown: only Talk is held back
  const rail = { desktop: { hidden: ["today"], known: ["inbox", "today", "upcoming", "logbook", "notes"] } };
  expect(prefsOf(rail).desktop.hidden).toEqual(["today", "talk"]);
  expect(prefsOf(rail).desktop.known).toEqual([...RAIL]);
  // Turned on, it stays on: the copy a device holds has read it, and knows it
  const on = withPatch(prefsOf(rail), { desktop: { hidden: ["today"] } });
  expect(on.desktop.hidden).toEqual(["today"]);
  expect(prefsOf(on).desktop.hidden).toEqual(["today"]);
  expect(withPatch(prefsOf(old), { phone: { hidden: [] } }).phone.hidden).toEqual([]);
});

test("task lists", () => {
  expect(prefsOf({ phone: { homeList: "inbox", tasksList: "nope" } }).phone).toMatchObject({ homeList: "inbox", tasksList: "today" });
});

test("shownRail: the sidebar's order, less what is hidden", () => {
  expect(shownRail({ hidden: ["today", "notes", "talk"] })).toEqual(["inbox", "upcoming", "logbook"]);
  expect(shownRail(DEFAULT_PREFS.desktop)).toEqual(["inbox", "today", "upcoming", "logbook"]);
  expect(shownRail({ hidden: [] })).toEqual([...RAIL]);
});

test("shownTabs and movedTab", () => {
  expect(shownTabs({ tabs: ["ask", "home", "tasks", "settings"], hidden: ["tasks"] })).toEqual(["ask", "home", "settings"]);
  expect(movedTab(["home", "tasks", "ask", "settings"], "ask", "home", false)).toEqual(["ask", "home", "tasks", "settings"]);
  expect(movedTab(["home", "tasks", "ask", "settings"], "home", "ask", true)).toEqual(["tasks", "ask", "home", "settings"]);
  expect(movedTab(["home", "tasks"], "home", "home", true)).toEqual(["home", "tasks"]);
});

describe("changes", () => {
  test("a patch names its keys and its groups' fields", () => {
    expect(patchPaths({ theme: "dawn", notes: { sort: "created" }, phone: { tabs: ["home"], start: "inbox" }, lens: null }))
      .toEqual(["theme", "notes.sort", "phone.tabs", "phone.start", "lens"]);
  });
  test("a patch sets only the fields it names", () => {
    const p = withPatch(DEFAULT_PREFS, { notes: { sort: "created" }, desktop: { hidden: ["logbook"] } });
    expect(p.notes).toEqual({ ...DEFAULT_PREFS.notes, sort: "created" });
    expect(p.desktop).toEqual({ ...DEFAULT_PREFS.desktop, hidden: ["logbook"] });
    expect(p.phone).toEqual(DEFAULT_PREFS.phone);
  });
  test("a patch still goes through the reader", () => {
    expect(withPatch(DEFAULT_PREFS, { phone: { tabs: ["ask"] } }).phone.tabs).toEqual(["ask", "home", "tasks", "notes", "talk", "settings"]);
    expect(withPatch({ ...DEFAULT_PREFS, agent: { ...DEFAULT_PREFS.agent, model: "m" } }, { agent: { model: undefined } }).agent.model).toBeUndefined();
    expect(withPatch({ ...DEFAULT_PREFS, lens: "x" }, { lens: null }).lens).toBeNull();
  });
  test("rebased: the server's values, the device's at its unsent paths", () => {
    const theirs = withPatch(DEFAULT_PREFS, { theme: "dawn", phone: { start: "inbox" } });
    const mine = withPatch(DEFAULT_PREFS, { accent: "rose", phone: { tabLabels: "never" } });
    const out = rebased(theirs, mine, ["accent", "phone.tabLabels"]);
    expect(out).toMatchObject({ theme: "dawn", accent: "rose" });
    expect(out.phone).toMatchObject({ start: "inbox", tabLabels: "never" });
  });
  test("paths", () => {
    expect(["theme", "lens", "notes.sort", "agent.model", "phone.tabs"].every(isPrefPath)).toBe(true);
    expect(["notes", "theme.x", "nope", "phone.tabs.x", "toString", 3].some(isPrefPath)).toBe(false);
    expect(prefAt(DEFAULT_PREFS, "phone.start")).toBe("home");
    expect(everyPath(DEFAULT_PREFS)).toContain("desktop.hidden");
    expect(everyPath(DEFAULT_PREFS).every(isPrefPath)).toBe(true);
  });
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
