// Days and moments. A day is `YYYY-MM-DD` in the owner's local calendar; its arithmetic and its words are dates.ts's, done on
// the string alone. Here: the day a moment falls on, a day as a Date, the weekdays, and how long ago a moment was.
//
// One rule for a day as a Date: local noon. Local midnight is not always there (a zone that springs forward at 00:00 skips it,
// and a Date made for it lands at 01:00 or on the day before), and a moment near midnight is one time-zone slip from the next
// day; noon always exists and stays on its day whichever formatter reads it. So the calendar, the planner and a first pull's
// order read a day the same way.

const two = (n: number) => String(n).padStart(2, "0");

/** The day the moment `t` (ms since the epoch) falls on, in local time. */
export const localDay = (t = Date.now()) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};

/** A day as a Date: local noon on it. */
export const dayDate = (day: string) => new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), 12);

/** The weekdays, Monday first: the words a When phrase is read against ("fri", "next tuesday"); their first three letters are
 *  a repeat's (`mon,thu`). */
export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

/** The weekdays as a planner heads its columns: Mon … Sun. */
export const WEEKDAY_HEADS = WEEKDAYS.map((w) => w[0].toUpperCase() + w.slice(1, 3));

/** A day's weekday, 0 for Monday to 6 for Sunday, from the day alone (no time zone in it). */
export const weekdayOf = (day: string) => (new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10))).getUTCDay() + 6) % 7;

// Relative ages for list rows and the sync line. Notes are read by "how long ago", not by clock time.
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `now`, `5m`, `3h`, `6d`, then `3 Oct`, then `2025-10-03` for another year. `t` in ms. */
export function ago(t: number, now = Date.now()) {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 45) return "now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  const d = new Date(t);
  return d.getFullYear() === new Date(now).getFullYear() ? `${d.getDate()} ${MON[d.getMonth()]}` : localDay(t);
}
