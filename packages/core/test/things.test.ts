import { describe, expect, it } from "bun:test";
import {
  dueFields, dueLabel, everyOf, progress, reminderPlan, weekdaysOf, whenFields, REPEATS,
} from "../src/things";
import { EVERY, newTask, patchTask, type Task } from "../src/todo";

const T = "2026-10-31";
let n = 0;
const task = (title: string, p: Partial<Task> = {}) => newTask(`t${String(++n).padStart(14, "0")}`, { title, ...p });

describe("When, deadline, repeat", () => {
  it("each When choice writes a patch patchTask accepts", () => {
    const t = task("x", { when: "2026-11-01", evening: true, remind: "09:00" });
    expect(patchTask(t, whenFields("today", T))).toMatchObject({ when: T, evening: false, remind: "09:00" });
    expect(patchTask(t, whenFields("evening", T))).toMatchObject({ when: T, evening: true });
    expect(patchTask(t, whenFields("tomorrow", T))).toMatchObject({ when: "2026-11-01", evening: false });
    expect(patchTask(t, whenFields({ day: "2026-12-24" }, T))).toMatchObject({ when: "2026-12-24" });
    expect(patchTask(t, whenFields("clear", T))).toMatchObject({ when: "", evening: false, remind: "" });
  });
  it("deadline choices", () => {
    const t = task("x", { due: "2026-11-05" });
    expect(patchTask(t, dueFields("today", T)).due).toBe(T);
    expect(patchTask(t, dueFields("tomorrow", T)).due).toBe("2026-11-01");
    expect(patchTask(t, dueFields({ day: "2027-01-02" }, T)).due).toBe("2027-01-02");
    expect(patchTask(t, dueFields("clear", T)).due).toBe("");
  });
  it("reads a deadline", () => {
    expect(dueLabel(T, T)).toEqual({ text: "Due today", late: false });
    expect(dueLabel("2026-10-30", T)).toEqual({ text: "Overdue · Yesterday", late: true });
    expect(dueLabel("2026-11-01", T)).toEqual({ text: "Due Tomorrow", late: false });
  });
  it("builds repeats the server accepts", () => {
    expect(everyOf(2, "w", false)).toBe("2w");
    expect(everyOf(3, "d", true)).toBe("+3d");
    expect(everyOf(0, "m", false)).toBe("1m");
    expect(everyOf(5000, "y", false)).toBe("999y");
    expect(weekdaysOf(["thu", "mon"])).toBe("mon,thu");
    expect(weekdaysOf([])).toBe("");
    for (const r of REPEATS) expect(r.every).toMatch(EVERY);
    expect(everyOf(12, "m", true)).toMatch(EVERY);
    expect(weekdaysOf(["sun", "sat", "fri"])).toMatch(EVERY);
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
