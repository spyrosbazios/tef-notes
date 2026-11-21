// What the task screens do with core/todo.ts's records, pure: the calendar's days, the repeats and reminder times on
// offer, the lists laid out in sections, the checklist's count, the reminders due. `now` is a Date.

import type { TaskList } from "./assistant";
import { views, type Task, type Views } from "./todo";

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

// ---- the lists, as a screen lays them out

/** The Logbook shows this many of the latest, as the phone's does. */
export const LOGBOOK = 100;

/** What a list shows, in the order its rows sit in. */
export function listOf(v: Views, kind: TaskList): Task[] {
  switch (kind) {
    case "today": return [...v.today, ...v.evening];
    case "upcoming": return v.upcoming.flatMap((g) => g.tasks);
    case "logbook": return v.logbook.slice(0, LOGBOOK);
    case "inbox": return v.inbox;
  }
}

/** The list a day's tasks are in: a day come or gone (overdue) is Today's, a later one Upcoming's (the rule of `views`). */
export const listOfDay = (day: string, today: string): "today" | "upcoming" => (day <= today ? "today" : "upcoming");

/** Which section of its list a task sits in: Today's two (`today`, `evening`), Upcoming's days, the Logbook's days done; the
 *  Inbox is one (`""`). */
export const sectionOf = (kind: TaskList, t: Task): string =>
  kind === "today" ? (t.evening ? "evening" : "today") : kind === "upcoming" ? t.when : kind === "logbook" ? t.done : "";

export type Section = { key: string; rows: Task[] };

/** A list in its sections, Today's before This Evening, with each of `lingering` (a task just ticked or unticked, as it was) that
 *  the list would have shown and no longer does slipped back in where it was: in its section, by `order` (the Logbook by the day
 *  done, the latest first). */
export function sectionsOf(v: Views, kind: TaskList, lingering: Iterable<Task>, today: string): Section[] {
  const base = listOf(v, kind), m = new Map<string, Task[]>();
  for (const t of base) { const k = sectionOf(kind, t); m.set(k, [...(m.get(k) ?? []), t]); }
  const have = new Set(base.map((t) => t.id));
  for (const t of lingering) {
    if (have.has(t.id) || !listOf(views([t], today), kind).length) continue;
    const k = sectionOf(kind, t), rows = [...(m.get(k) ?? [])];
    const at = kind === "logbook" ? rows.findIndex((r) => r.done < t.done) : rows.findIndex((r) => r.order > t.order);
    rows.splice(at < 0 ? rows.length : at, 0, t);
    m.set(k, rows);
  }
  const out = [...m].map(([key, rows]) => ({ key, rows }));
  return kind === "today" ? out.sort((a, b) => (a.key === "today" ? -1 : b.key === "today" ? 1 : 0)) : out;
}

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
