// What the task screens do with core/todo.ts's records, pure: the calendar's days, the repeats and reminder times on
// offer, the checklist's count, the reminders due. `now` is a Date.

import type { Task } from "./todo";

// ---- days, repeats, reminder times

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

/** The reminder times a task can have: on its `when` day. */
export const REMIND_TIMES = ["08:00", "09:00", "12:00", "15:00", "18:00", "20:00"];

// ---- reading a task

/** Checklist items ticked out of all; null when there are none. */
export const progress = (t: Pick<Task, "checklist">): [number, number] | null =>
  t.checklist.length ? [t.checklist.filter((i) => i.done).length, t.checklist.length] : null;

// ---- reminders

export type Reminder = { id: string; at: number; title: string; task: string };

/** When a task's reminder rings, in the clock's own zone (the phone's, or the server's TZ): its `when` day at its `remind`
 *  time; null for a task without both. */
export const remindAt = (t: Pick<Task, "when" | "remind">): number | null =>
  t.when && t.remind
    ? new Date(+t.when.slice(0, 4), +t.when.slice(5, 7) - 1, +t.when.slice(8, 10), +t.remind.slice(0, 2), +t.remind.slice(3, 5)).getTime()
    : null;

/** The notifications to have scheduled: open tasks with a day and a time, that time still ahead and within `days`; the
 *  soonest `cap` of them (the OS keeps only so many). A task with a day but no time needs none. */
export function reminderPlan(tasks: Task[], now: Date, days = 30, cap = 200): Reminder[] {
  const from = now.getTime(), to = from + days * 86_400_000;
  const out: Reminder[] = [];
  for (const t of tasks) {
    if (t.done || !t.when || !t.remind) continue;
    const at = remindAt(t);
    if (at === null || at <= from || at > to) continue;
    out.push({ id: `task:${t.id}`, at, title: t.title, task: t.id });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, cap);
}
