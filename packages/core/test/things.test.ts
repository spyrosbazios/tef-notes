import { describe, expect, it } from "bun:test";
import { progress, reminderPlan, remindAt, REPEATS } from "../src/things";
import { EVERY, newTask, type Task } from "../src/todo";

const T = "2026-10-31";
let n = 0;
const task = (title: string, p: Partial<Task> = {}) => newTask(`t${String(++n).padStart(14, "0")}`, { title, ...p });

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
