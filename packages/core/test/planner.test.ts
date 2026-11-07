import { describe, expect, it } from "bun:test";
import { dayRange, monthDays, monthLoad, monthOf, plannedByDay, shadeOf, weekOf } from "../src/planner";
import { newTask, type Task } from "../src/todo";

let i = 0;
const task = (p: Partial<Task> = {}) => newTask(`t${String(++i).padStart(14, "0")}`, { title: "t", ...p });

describe("planner", () => {
  it("steps months across a year", () => {
    expect(monthOf("2026-11-06", 0)).toBe("2026-11-01");
    expect(monthOf("2026-11-06", 2)).toBe("2027-01-01");
    expect(monthOf("2026-01-31", -1)).toBe("2025-12-01");
  });
  it("lays a month out in whole weeks, Monday first, blanks either side", () => {
    const days = monthDays("2026-11-01");                  // a Sunday: six blanks before it
    expect(days.length % 7).toBe(0);
    expect(days.slice(0, 7)).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(days.filter(Boolean)).toHaveLength(30);
    expect(days.at(-1)).toBeNull();                        // the 30th is a Monday
  });
  it("finds a week's Monday and steps weeks", () => {
    expect(weekOf("2026-11-06", 0)).toBe("2026-11-02");      // a Friday
    expect(weekOf("2026-11-02", 0)).toBe("2026-11-02");      // a Monday is its own
    expect(weekOf("2026-11-08", 0)).toBe("2026-11-02");      // a Sunday ends the week
    expect(weekOf("2026-11-06", -1)).toBe("2026-10-26");
    expect(weekOf("2026-12-30", 1)).toBe("2027-01-04");
  });
  it("lists days in a row across a month's end", () => {
    expect(dayRange("2026-11-29", 4)).toEqual(["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"]);
    expect(dayRange("2026-11-29", 0)).toEqual([]);
  });
  it("counts open tasks by planned day and deadline, once a day", () => {
    const a = task({ when: "2026-11-10" }), b = task({ when: "2026-11-10", due: "2026-11-12" }), c = task({ due: "2026-11-10", when: "2026-11-10" });
    const done = task({ when: "2026-11-10", done: "2026-11-05" }), inbox = task();
    const m = plannedByDay([a, b, c, done, inbox]);
    expect(m.get("2026-11-10")).toEqual([a, b, c]);
    expect(m.get("2026-11-12")).toEqual([b]);
    expect(monthLoad(monthDays("2026-11-01"), m)).toEqual({ total: 4, busiest: 3 });
    expect([0, 1, 4, 9].map(shadeOf)).toEqual([0, 1, 4, 4]);
  });
});
