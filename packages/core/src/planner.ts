// Home's planner: the web's a month of days, Monday first; the phone's a strip of days scrolled past a fixed slot. Each day
// is shaded by how many open tasks are planned for it (its `when`) or due on it. The clients draw it; the days, the counts
// and the shade are worked out here.
import { addDays } from "./dates";
import type { Task } from "./todo";

/** How many shades a day can take: none, then 1, 2, 3, 4 or more tasks. */
export const SHADES = 5;
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** A day at noon, local: what a client formats it from (noon keeps a DST shift off the date). */
export const dayDate = (day: string) => new Date(`${day}T12:00:00`);
const pad = (n: number) => String(n).padStart(2, "0");

/** The first of the month `n` months from `day`'s. */
export function monthOf(day: string, n: number): string {
  const d = dayDate(day);
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

/** The Monday of the week `n` weeks from `day`'s. */
export const weekOf = (day: string, n: number) => addDays(day, 7 * n - ((dayDate(day).getDay() + 6) % 7));

/** `n` days in a row from `first`: the phone's strip. */
export const dayRange = (first: string, n: number) => Array.from({ length: n }, (_, i) => addDays(first, i));

/** Whole weeks, Monday first, covering the month that starts on `first`: its days, with null for the days of the months either side. */
export function monthDays(first: string): (string | null)[] {
  const start = weekOf(first, 0);
  const next = monthOf(first, 1);
  const out: (string | null)[] = [];
  for (let d = start; d < next || out.length % 7; d = addDays(d, 1)) out.push(d >= first && d < next ? d : null);
  return out;
}

/** Every open task under each day it is planned for or due on (once a day, when both fall on it). */
export function plannedByDay(tasks: readonly Task[]): Map<string, Task[]> {
  const m = new Map<string, Task[]>();
  const put = (day: string, t: Task) => { const l = m.get(day) ?? []; if (!l.includes(t)) m.set(day, [...l, t]); };
  for (const t of tasks) if (!t.done) { if (t.when) put(t.when, t); if (t.due) put(t.due, t); }
  return m;
}

/** How many tasks the month's days hold in all, and on its busiest day. */
export function monthLoad(days: readonly (string | null)[], byDay: ReadonlyMap<string, Task[]>): { total: number; busiest: number } {
  let total = 0, busiest = 0;
  for (const d of days) { const n = d ? byDay.get(d)?.length ?? 0 : 0; total += n; busiest = Math.max(busiest, n); }
  return { total, busiest };
}

/** The shade of a day holding `n` tasks: 0 for none up to SHADES - 1 for four or more. */
export const shadeOf = (n: number) => Math.min(SHADES - 1, n);
