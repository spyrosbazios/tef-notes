import { describe, expect, it } from "bun:test";
import { taskCardOf } from "../src/agent";
import { newTask } from "../src/todo";
import { isWidgetTool, widgetOf, WIDGET_TOOLS, type Widget } from "../src/widgets";

const card = taskCardOf(newTask("abc123def456ghi", { title: "Dentist", when: "2026-11-06", remind: "10:00" }));
const note = { kind: "note" as const, path: "notes/a.md", title: "A", preview: "body" };

describe("widgetOf", () => {
  const widgets: Widget[] = [
    { type: "day", date: "2026-11-06", booked: [{ at: "10:00", until: "11:00", task: card, clash: true }], unscheduled: [card], more: 2, done: 1 },
    { type: "week", start: "2026-11-02", days: [{ date: "2026-11-02", open: 3, booked: 1, overdue: 3, top: [{ id: "t1", title: "x" }] }] },
    { type: "review", from: "2026-10-31", to: "2026-11-06", days: 7, done: 4, added: 5, notesAdded: 2, notesEdited: 3, stalled: [{ task: card, idle: 20 }], stalledTotal: 6, tags: [{ tag: "work", count: 3 }] },
    { type: "quote", path: "notes/a.md", title: "A", quote: "the words", before: "…so ", after: " go on" },
    { type: "link", preview: { url: "https://example.com", title: "T", description: "", site: "example.com", image: "", icon: "", picture: "" } },
    { type: "lens", tags: ["work"], exclude: ["archive"], name: "Work", accent: "teal", notes: { count: 7, sample: [note] }, tasks: { count: 1, sample: [card] } },
  ];
  it("reads back each widget as the tool wrote it, through JSON as a saved chat holds it", () => {
    for (const w of widgets) expect(widgetOf(JSON.parse(JSON.stringify({ widget: w })))).toEqual(w);
  });
  it("is null for an error, a missing widget or an unknown type", () => {
    for (const x of [null, "x", [], {}, { error: "no" }, { widget: null }, { widget: { type: "map" } }, { widget: "day" }]) expect(widgetOf(x)).toBeNull();
  });
  it("is null for a widget that doesn't hold together", () => {
    expect(widgetOf({ widget: { type: "day", date: "2026-02-30", booked: [], unscheduled: [] } })).toBeNull();
    expect(widgetOf({ widget: { type: "week", start: "2026-11-02", days: [] } })).toBeNull();
    expect(widgetOf({ widget: { type: "quote", path: "../x.md", title: "x", quote: "q" } })).toBeNull();
    expect(widgetOf({ widget: { type: "quote", path: "notes/a.md", title: "x", quote: "" } })).toBeNull();
    expect(widgetOf({ widget: { type: "link", preview: { url: "javascript:alert(1)", title: "x" } } })).toBeNull();
    expect(widgetOf({ widget: { type: "link", preview: { url: "https://a.b", title: "", image: "" } } })).toBeNull();
    expect(widgetOf({ widget: { type: "lens", tags: ["a"] } })).toBeNull();
  });
  it("drops the pieces that are wrong and keeps the rest", () => {
    const w = widgetOf({ widget: { type: "day", date: "2026-11-06", done: -3, booked: [{ at: "10:00", until: "11:00", task: card }, { at: "later", until: "11:00", task: card }, { at: "09:00", until: "10:00", task: { kind: "note" } }],
      unscheduled: [card, { kind: "task" }, note, 7] } });
    expect(w).toEqual({ type: "day", date: "2026-11-06", booked: [{ at: "10:00", until: "11:00", task: card }], unscheduled: [card], done: 0 });
    const lens = widgetOf({ widget: { type: "lens", tags: ["a", 1], exclude: "b", accent: "theme", notes: { count: 2.5, sample: [card, note] }, tasks: { count: 1, sample: [card, note] } } });
    expect(lens).toEqual({ type: "lens", tags: ["a"], exclude: [], notes: { count: 0, sample: [note] }, tasks: { count: 1, sample: [card] } });
  });
  it("names the tools that carry one", () => {
    expect(WIDGET_TOOLS.every(isWidgetTool)).toBe(true);
    expect(isWidgetTool("show_items")).toBe(false);
    expect(isWidgetTool("find_free_slots")).toBe(false);
  });
});
