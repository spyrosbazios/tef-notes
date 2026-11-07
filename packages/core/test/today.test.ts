import { describe, expect, it } from "bun:test";
import { dayTasks } from "../src/today";
import { newTask, type Task } from "../src/todo";

const T = "2026-11-01";
let n = 0;
const task = (title: string, p: Partial<Task> = {}) => newTask(`t${String(++n).padStart(14, "0")}`, { title, ...p });

describe("dayTasks", () => {
  it("lists Today's open tasks, This Evening's after them, and the ones ticked today", () => {
    const late = task("late", { when: "2026-10-30", order: 2 }), now = task("now", { when: T, order: 1 });
    const eve = task("eve", { when: T, evening: true }), due = task("due", { due: T });
    const ticked = task("ticked", { when: T, done: T }), old = task("old", { when: "2026-10-01", done: "2026-10-02" });
    const later = task("later", { when: "2026-11-03" }), inbox = task("inbox");
    const d = dayTasks([eve, late, now, due, ticked, old, later, inbox], T);
    expect(d.open.map((i) => i.title)).toEqual(["due", "now", "late", "eve"]);
    expect(d.open.find((i) => i.title === "eve")?.evening).toBe(true);
    expect(d.done.map((i) => i.title)).toEqual(["ticked"]);
    expect(d.total).toBe(5);
  });
});
