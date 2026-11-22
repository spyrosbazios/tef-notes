import { describe, expect, test } from "bun:test";
import { FORMAT_TOOLS, NARROW_BAR, narrowBar, placesFor, toolSlotsOf, toolsAt } from "../src/format-tools";
import { movedSlot, placedAt } from "../src/note-actions";
import { DEFAULT_PREFS, patchPaths, prefsOf, withPatch } from "../src/prefs";

describe("toolSlotsOf", () => {
  test("nothing stored: every tool in the bar, in order", () => {
    expect(toolsAt(toolSlotsOf(undefined, "desktop"), "bar")).toEqual([...FORMAT_TOOLS]);
    expect(toolsAt(toolSlotsOf(undefined, "phone"), "bar")).toEqual([...FORMAT_TOOLS]);
  });
  test("keeps order and places, drops the unknown, adds the new at the end", () => {
    const s = toolSlotsOf([{ id: "redo", place: "off" }, { id: "nope", place: "bar" }, { id: "bold", place: "menu" }, { id: "redo", place: "bar" }], "desktop");
    expect(s.slice(0, 2)).toEqual([{ id: "redo", place: "off" }, { id: "bold", place: "menu" }]);
    expect(s.find((x) => x.id === "italic")).toEqual({ id: "italic", place: "menu" });
    expect(s.find((x) => x.id === "link")).toEqual({ id: "link", place: "bar" });
    expect(s).toHaveLength(FORMAT_TOOLS.length);
  });
  test("a place the layout lacks is its bar: the phone has no menu, Link is never a menu's", () => {
    expect(toolSlotsOf([{ id: "bold", place: "menu" }], "phone")[0]).toEqual({ id: "bold", place: "bar" });
    expect(toolSlotsOf([{ id: "link", place: "menu" }], "desktop")[0]).toEqual({ id: "link", place: "bar" });
    expect(placesFor("desktop", "bold")).toContain("menu");
    expect(placesFor("phone", "bold")).not.toContain("menu");
  });
});

test("a narrow bar keeps its first few and Link; the rest go under the menu first", () => {
  let s = placedAt(toolSlotsOf(undefined, "desktop"), "undo", "menu");
  s = movedSlot(s, "link", "redo", true);
  const n = narrowBar(s);
  expect(n.bar).toEqual([...FORMAT_TOOLS.filter((t) => t !== "link").slice(0, NARROW_BAR), "link"]);
  expect(n.menu.at(-1)).toBe("undo");
  expect(n.menu).not.toContain("link");
});

test("in the preferences: a layout's own field, read back whole", () => {
  expect(patchPaths({ desktop: { formatTools: [] } })).toEqual(["desktop.formatTools"]);
  const p = withPatch(DEFAULT_PREFS, { phone: { formatTools: placedAt(DEFAULT_PREFS.phone.formatTools, "code", "off") } });
  expect(toolsAt(p.phone.formatTools, "off")).toEqual(["code"]);
  expect(toolsAt(p.desktop.formatTools, "off")).toEqual([]);
  expect(prefsOf(JSON.parse(JSON.stringify(p)))).toEqual(p);
});
