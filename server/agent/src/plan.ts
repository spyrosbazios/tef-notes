// What the show_* and find_free_slots tools work out, pure: the owner's tasks and notes in, a widget's data out (the types
// are packages/core/src/widgets.ts's), so test/widgets.test.ts holds the rules without a server.
//
// A task has no length: its `when` day and `remind` time book it into an hour, and that whole hour is held. It is the unit the
// double-booking check (todoTools.ts `clash`) counts in, so a clash a widget flags is one that check would refuse.
import { taskCardOf } from "@/core/agent";
import { addDays } from "@/core/dates";
import { fold, parseNote } from "@/core/notes";
import { plannedByDay } from "@/core/planner";
import { localDay } from "@/core/time";
import { dedupeTags, type Task } from "@/core/todo";
import { WIDGET_LIMITS, type BookedTask, type DayWidget, type ReviewWidget, type WeekWidget } from "@/core/widgets";
import type { Meta } from "./notes";

const DAY = 86_400_000;
const two = (n: number) => String(n).padStart(2, "0");

/** A task's slot: its day and the hour of its reminder; none without both. */
export type Slot = Pick<Task, "when" | "remind">;
export const slotOf = (t: Slot) => (t.when && t.remind ? `${t.when} ${t.remind.slice(0, 2)}` : "");

const byOrder = (a: Task, b: Task) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const open = (tasks: readonly Task[]) => tasks.filter((t) => !t.done).sort(byOrder);
const booking = (t: Task, day: string) => t.when === day && !!t.remind;
const byHour = (a: Task, b: Task) => (a.remind < b.remind ? -1 : a.remind > b.remind ? 1 : byOrder(a, b));

/** The end of the hour a time falls in: 09:30 holds until 10:00, 23:xx until 24:00. */
const hourEnd = (hm: string) => `${two(+hm.slice(0, 2) + 1)}:00`;

// ---- a day and a week

/** The day `date`: booked hours, with the clashes flagged, the other open tasks planned for it or due on it, and how many were ticked. */
export function dayOfTasks(tasks: readonly Task[], date: string): DayWidget {
  const planned = plannedByDay(open(tasks)).get(date) ?? [];
  const booked = planned.filter((t) => booking(t, date)).sort(byHour);
  const held = new Map<string, number>();
  for (const t of booked) held.set(slotOf(t), (held.get(slotOf(t)) ?? 0) + 1);
  const rest = planned.filter((t) => !booking(t, date));
  return {
    type: "day", date,
    booked: booked.map((t): BookedTask => ({ at: t.remind, until: hourEnd(t.remind), task: taskCardOf(t), ...((held.get(slotOf(t)) ?? 0) > 1 ? { clash: true as const } : {}) })),
    unscheduled: rest.slice(0, WIDGET_LIMITS.tasks).map(taskCardOf),
    ...(rest.length > WIDGET_LIMITS.tasks ? { more: rest.length - WIDGET_LIMITS.tasks } : {}),
    done: tasks.filter((t) => t.done === date).length,
  };
}

/** Seven days from `start`: each day's open tasks (planned for it or due on it), how many hold an hour, the overdue ones (tasks
 *  still open on a day before `today`) and the first few titles, booked ones first. */
export function weekOfTasks(tasks: readonly Task[], start: string, today: string): WeekWidget {
  const planned = plannedByDay(open(tasks));
  return {
    type: "week", start,
    days: Array.from({ length: 7 }, (_, i) => {
      const date = addDays(start, i), list = planned.get(date) ?? [];
      const booked = list.filter((t) => booking(t, date)).sort(byHour);
      return {
        date, open: list.length, booked: booked.length, overdue: date < today ? list.length : 0,
        top: [...booked, ...list.filter((t) => !booking(t, date))].slice(0, WIDGET_LIMITS.top).map((t) => ({ id: t.id, title: t.title })),
      };
    }),
  };
}

// ---- free time

/** The working day find_free_slots looks within unless told otherwise. */
export const WORK = { from: "09:00", to: "18:00" } as const;
export type FreeSlot = { from: string; to: string; minutes: number };

const toMin = (hm: string) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
const toHm = (m: number) => `${two(Math.floor(m / 60))}:${two(m % 60)}`;

/** The gaps of `date`, between `from` and `to` (default: working hours), at least `minutes` long, earliest first: what is left
 *  once each open task booked that day holds its hour. Only hours of the day are looked at, never the tasks without one.
 *  `now`: for today, nothing before the next quarter hour is offered. */
export function freeSlots(tasks: readonly Task[], date: string, minutes: number, from: string = WORK.from, to: string = WORK.to, now?: Date): { slots: FreeSlot[]; booked: number } {
  const held = open(tasks).filter((t) => booking(t, date)).map((t) => toMin(t.remind)).map((m) => Math.floor(m / 60) * 60);
  let start = toMin(from);
  const end = toMin(to);
  if (now && localDay(now.getTime()) === date) start = Math.max(start, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15);
  const slots: FreeSlot[] = [];
  let at = start;
  for (const h of [...new Set(held)].sort((a, b) => a - b)) {
    if (h + 60 <= at || h >= end) continue;
    if (h - at >= minutes) slots.push({ from: toHm(at), to: toHm(h), minutes: h - at });
    at = Math.max(at, h + 60);
  }
  if (end - at >= minutes) slots.push({ from: toHm(at), to: toHm(end), minutes: end - at });
  return { slots, booked: held.length };
}

// ---- the review

/** How long an open task may go unchanged before it counts as stalled, in days. */
export const STALLED_DAYS = 14;

/** A task's times on the server (`created`, `updated`, ms): the core's Task has neither. */
export type Stamp = { created: number; updated: number };

/** The last `days` days up to the day of `now`. Counts by local day: tasks ticked in them (`done`), made (`created`), notes made
 *  (their `created` day) and edited (changed in them, not made in them). A task is stalled when open and unchanged for
 *  STALLED_DAYS: any write moves `updated`, the auto-tagger's too, so a task it just tagged is not. Top tags: each tag once per
 *  item, over what was done, added, or touched. `notes`: the notes only, not the memory file. */
export function reviewOf(tasks: readonly Task[], stamps: ReadonlyMap<string, Stamp>, notes: readonly Meta[], days: number, now = new Date()): ReviewWidget {
  const to = localDay(now.getTime()), from = addDays(to, 1 - days), within = (day: string) => day >= from && day <= to;
  const day = (ms: number) => localDay(ms);
  const made = tasks.filter((t) => { const s = stamps.get(t.id); return !!s && within(day(s.created)); });
  const ticked = tasks.filter((t) => t.done && within(t.done));
  const stale = open(tasks).flatMap((t) => { const s = stamps.get(t.id); return s && now.getTime() - s.updated >= STALLED_DAYS * DAY ? [{ t, idle: Math.floor((now.getTime() - s.updated) / DAY) }] : []; })
    .sort((a, b) => b.idle - a.idle);
  const fresh = notes.filter((n) => within(parseNote(n.path, n.text).created));
  const edited = notes.filter((n) => within(day(n.updated)) && !fresh.includes(n));
  const seen = new Map<string, { tag: string; count: number }>();
  for (const tags of [...new Set([...made, ...ticked])].map((t) => t.tags).concat([...fresh, ...edited].map((n) => n.tags)))
    for (const tag of dedupeTags(tags)) { const k = fold(tag), e = seen.get(k); if (e) e.count++; else seen.set(k, { tag, count: 1 }); }
  return {
    type: "review", from, to, days, done: ticked.length, added: made.length, notesAdded: fresh.length, notesEdited: edited.length,
    stalled: stale.slice(0, WIDGET_LIMITS.stalled).map(({ t, idle }) => ({ task: taskCardOf(t), idle })), stalledTotal: stale.length,
    tags: [...seen.values()].sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1)).slice(0, WIDGET_LIMITS.tags),
  };
}

// ---- a quote

const AROUND = 80;
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

/** `quote` in the note's body, whitespace aside word for word (case, accents and markup as they are), with some of what surrounds it
 *  (`before + quote + after` reads as the passage, the spaces at its edges kept); null when the body doesn't hold it. The quote
 *  comes back as the note has it. */
export function quoteIn(body: string, quote: string): { quote: string; before: string; after: string } | null {
  const text = flat(body), want = flat(quote), at = want ? text.indexOf(want) : -1;
  if (at < 0) return null;
  const end = at + want.length, a = Math.max(0, at - AROUND), b = Math.min(text.length, end + AROUND);
  return { quote: want, before: `${a > 0 ? "…" : ""}${text.slice(a, at).trimStart()}`, after: `${text.slice(end, b).trimEnd()}${b < text.length ? "…" : ""}` };
}
