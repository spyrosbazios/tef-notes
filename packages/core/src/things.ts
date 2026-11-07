// What the phone's task screens do with core/todo.ts's records, pure: what each When, deadline and repeat choice
// writes, how a deadline reads, the checklist's count, which reminders to schedule.
// `today` is the caller's local `YYYY-MM-DD` (localDay()), `now` a Date.

import { addDays, dayLabel } from "./dates";
import type { Task, TaskPatch } from "./todo";

// ---- When, deadline, repeat

export type WhenChoice = "today" | "evening" | "tomorrow" | "clear" | { day: string };

/** What a When choice writes. A day leaves a reminder alone; clear takes it off (a reminder needs its day). */
export function whenFields(c: WhenChoice, today: string): TaskPatch {
  if (c === "today") return { when: today, evening: false };
  if (c === "evening") return { when: today, evening: true };
  if (c === "tomorrow") return { when: addDays(today, 1), evening: false };
  if (c === "clear") return { when: "", evening: false, remind: "" };
  return { when: c.day, evening: false };
}

export type DeadlineChoice = "today" | "tomorrow" | "clear" | { day: string };

export function dueFields(c: DeadlineChoice, today: string): TaskPatch {
  if (c === "today") return { due: today };
  if (c === "tomorrow") return { due: addDays(today, 1) };
  if (c === "clear") return { due: "" };
  return { due: c.day };
}

/** A deadline as a row shows it, and whether it has passed. */
export function dueLabel(due: string, today: string): { text: string; late: boolean } {
  if (due === today) return { text: "Due today", late: false };
  return due < today ? { text: `Overdue · ${dayLabel(due, today)}`, late: true } : { text: `Due ${dayLabel(due, today)}`, late: false };
}

/** `Date` (the calendar's pick, local midnight) as a day. */
export const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** A day as the `Date` the calendar draws (local midnight). */
export const dateOf = (day: string) => new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));

/** The repeats on offer as they are stored; anything else a task carries is "Custom". */
export const REPEATS: { every: string; label: string }[] = [
  { every: "1d", label: "Every day" }, { every: "1w", label: "Every week" }, { every: "1m", label: "Every month" }, { every: "1y", label: "Every year" },
  { every: "mon,tue,wed,thu,fri", label: "Every weekday" },
];

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const UNITS = ["d", "w", "m", "y"] as const;

/** A custom repeat: every `n` days, weeks, months or years, from the scheduled day, or (`after`) from the day it was done. */
export const everyOf = (n: number, unit: (typeof UNITS)[number], after: boolean) => `${after ? "+" : ""}${Math.min(999, Math.max(1, Math.floor(n)))}${unit}`;

/** Weekdays as a repeat, in week order; none is no repeat. */
export const weekdaysOf = (days: string[]) => WEEKDAYS.filter((d) => days.includes(d)).join(",");

/** The reminder times a task can have: on its `when` day. */
export const REMIND_TIMES = ["08:00", "09:00", "12:00", "15:00", "18:00", "20:00"];

// ---- reading a task

/** Checklist items ticked out of all; null when there are none. */
export const progress = (t: Pick<Task, "checklist">): [number, number] | null =>
  t.checklist.length ? [t.checklist.filter((i) => i.done).length, t.checklist.length] : null;

// ---- reminders

export type Reminder = { id: string; at: number; title: string; task: string };

/** The notifications to have scheduled: open tasks with a day and a time, that time still ahead and within `days`; the
 *  soonest `cap` of them (the OS keeps only so many). A task with a day but no time needs none. */
export function reminderPlan(tasks: Task[], now: Date, days = 30, cap = 200): Reminder[] {
  const from = now.getTime(), to = from + days * 86_400_000;
  const out: Reminder[] = [];
  for (const t of tasks) {
    if (t.done || !t.when || !t.remind) continue;
    const at = new Date(+t.when.slice(0, 4), +t.when.slice(5, 7) - 1, +t.when.slice(8, 10), +t.remind.slice(0, 2), +t.remind.slice(3, 5)).getTime();
    if (at <= from || at > to) continue;
    out.push({ id: `task:${t.id}`, at, title: t.title, task: t.id });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, cap);
}
