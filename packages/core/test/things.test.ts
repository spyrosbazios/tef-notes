import { describe, expect, it } from "bun:test";
import { listOf, listOfDay, LOGBOOK, progress, reminderPlan, remindAt, REPEATS, sectionOf, sectionsOf } from "../src/things";
import { EVERY, newTask, views, type Task } from "../src/todo";

const T = "2026-10-31";
let n = 0;
const task = (title: string, p: Partial<Task> = {}) => newTask(`t${String(++n).padStart(14, "0")}`, { title, ...p });

describe("the lists laid out", () => {
  const titles = (l: { key: string; rows: Task[] }[]) => l.map((s) => [s.key, s.rows.map((t) => t.title)]);

  it("Today lists its own before This Evening, Upcoming by day, the Logbook only the latest", () => {
    const ts = [task("eve", { when: T, evening: true, order: 0 }), task("now", { when: T, order: 1 }), task("later", { when: "2026-11-02" }),
      ...Array.from({ length: LOGBOOK + 5 }, (_, i) => task(`done ${i}`, { done: "2026-10-01" }))];
    const v = views(ts, T);
    expect(listOf(v, "today").map((t) => t.title)).toEqual(["now", "eve"]);
    expect(titles(sectionsOf(v, "today", [], T))).toEqual([["today", ["now"]], ["evening", ["eve"]]]);
    expect(titles(sectionsOf(v, "upcoming", [], T))).toEqual([["2026-11-02", ["later"]]]);
    expect(listOf(v, "logbook")).toHaveLength(LOGBOOK);
    expect(sectionOf("inbox", ts[0]!)).toBe("");
  });

  it("a task just ticked lingers where it was, by order; one the list never showed doesn't", () => {
    const a = task("a", { when: T, order: 0 }), b = task("b", { when: T, order: 1 }), c = task("c", { when: T, order: 2 });
    const done = { ...b, done: T }, v = views([a, done, c], T);
    expect(titles(sectionsOf(v, "today", [b], T))).toEqual([["today", ["a", "b", "c"]]]);
    expect(titles(sectionsOf(v, "today", [task("elsewhere", { when: "2026-12-01" })], T))).toEqual([["today", ["a", "c"]]]);
  });

  it("a task just unticked lingers in the Logbook by the day it was done", () => {
    const x = task("x", { done: "2026-10-30" }), y = task("y", { done: "2026-10-28" }), back = task("back", { done: "2026-10-29" });
    expect(titles(sectionsOf(views([x, y], T), "logbook", [back], T))).toEqual([["2026-10-30", ["x"]], ["2026-10-28", ["y"]], ["2026-10-29", ["back"]]]);
  });

  it("a day is Today's once it has come, Upcoming's before, as views lists its tasks", () => {
    for (const day of ["2026-10-01", T, "2026-11-01"]) {
      const v = views([task("x", { when: day })], T);
      expect(listOf(v, listOfDay(day, T))).toHaveLength(1);
    }
  });
});

describe("repeats", () => {
  it("are on offer as the server stores them", () => {
    for (const r of REPEATS) expect(r.every).toMatch(EVERY);
  });
});

describe("reading a task", () => {
  it("counts the checklist", () => {
    expect(progress(task("x"))).toBeNull();
    expect(progress(task("x", { checklist: [{ id: "a", text: "a", done: true }, { id: "b", text: "b", done: false }] }))).toEqual([1, 2]);
  });
});

describe("reminders", () => {
  const now = new Date(2026, 9, 31, 10, 0);
  it("plans open tasks with a day and a time ahead, soonest first", () => {
    const a = task("a", { when: T, remind: "09:00" }), b = task("b", { when: T, remind: "18:00" }), c = task("c", { when: "2026-11-02", remind: "08:00" });
    const skipped = [
      task("d", { when: T }), task("e", { remind: "12:00" }), task("f", { when: T, remind: "20:00", done: T }), task("g", { when: "2026-12-30", remind: "08:00" }),
    ];
    const plan = reminderPlan([c, b, a, ...skipped], now);
    expect(plan.map((r) => [r.task, r.title])).toEqual([[b.id, "b"], [c.id, "c"]]);
    expect(plan[0]).toMatchObject({ id: `task:${b.id}`, at: new Date(2026, 9, 31, 18, 0).getTime() });
    expect(reminderPlan([c, b], now, 30, 1)).toHaveLength(1);
  });
});

describe("remindAt", () => {
  it("is the when day at the remind time, local; null without both", () => {
    expect(remindAt({ when: "2026-11-01", remind: "09:30" })).toBe(new Date(2026, 10, 1, 9, 30).getTime());
    expect(remindAt({ when: "2026-11-01", remind: "" })).toBeNull();
    expect(remindAt({ when: "", remind: "09:30" })).toBeNull();
  });
});
