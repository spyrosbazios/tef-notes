// Days for the task views: their arithmetic (addDays, addMonths, a repeat's nextOccurrence), what "fri", "in 3d" or
// "nov 12" mean (parseWhen), and how a stored day reads back (dayLabel, dayParts, everyLabel). Pure and local-day:
// `today` is the caller's `YYYY-MM-DD` (localDay()), never read here.

/** `1d 2w 1m 1y` (fixed: from the scheduled date), `+3d` (from the day it was done), `mon,thu` (those weekdays). */
export type Every = string;

// ---- arithmetic

const two = (n: number) => String(n).padStart(2, "0");
const ms = (day: string) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
const fmt = (t: number) => { const d = new Date(t); return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`; };
const DAY_MS = 86_400_000;
export const addDays = (day: string, n: number) => fmt(ms(day) + n * DAY_MS);
/** Days from `a` to `b`: negative when `b` is earlier. */
export const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY_MS);
const daysIn = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** `n` months on. A month's last day stays a last day (Jan 31 → Feb 28 → Mar 31); a day the month lacks becomes its last. */
export function addMonths(day: string, n: number): string {
  const y = +day.slice(0, 4), m = +day.slice(5, 7) - 1, d = +day.slice(8, 10);
  const t = new Date(Date.UTC(y, m + n, 1)), ty = t.getUTCFullYear(), tm = t.getUTCMonth(), last = daysIn(ty, tm);
  return `${ty}-${two(tm + 1)}-${two(d === daysIn(y, m) ? last : Math.min(d, last))}`;
}

function step(day: string, every: string): string {
  const m = /^\+?(\d+)([dwmy])$/.exec(every)!, n = +m[1];
  return m[2] === "d" ? addDays(day, n) : m[2] === "w" ? addDays(day, 7 * n) : addMonths(day, m[2] === "m" ? n : 12 * n);
}

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** The next day a repeating task falls on, done `today`. Fixed (`1w`, `mon,thu`): the schedule's next day after both
 *  `base` (its scheduled day) and today, so a late tick never leaves a backlog. `+3d`: three days after today. */
export function nextOccurrence(every: Every, base: string, today: string): string {
  if (every.startsWith("+")) return step(today, every.slice(1));
  if (/^[a-z]/.test(every)) {
    const days = new Set(every.split(",").map((d) => DAY_NAMES.indexOf(d)));
    let d = addDays(base > today ? base : today, 1);
    while (!days.has(new Date(ms(d)).getUTCDay())) d = addDays(d, 1);
    return d;
  }
  let d = step(base, every);
  while (d <= today) d = step(d, every);
  return d;
}

// ---- in words

/** What a When choice sets: a day, This Evening or not. Fits setTaskMeta/addTask's patch. */
export type Schedule = { when: string; evening: boolean };

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const dow = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
const short = (day: string) => `${cap(MONTHS[+day.slice(5, 7) - 1]).slice(0, 3)} ${+day.slice(8, 10)}`;

/** `y-m-d` when it is a real day (Feb 30 is not), else null. */
function make(y: number, m0: number, d: number): string | null {
  const day = `${y}-${two(m0 + 1)}-${two(d)}`, t = new Date(`${day}T00:00:00Z`);
  return t.getUTCFullYear() === y && t.getUTCMonth() === m0 && t.getUTCDate() === d ? day : null;
}

/** The index of the name `w` starts (three letters at least: `sep`, `sept`, `tues`), else -1. */
const nameIn = (names: string[], w: string) => (w.length >= 3 ? names.findIndex((n) => n.startsWith(w)) : -1);

/** The next `weekday` strictly after `today`. */
function nextWeekday(weekday: number, today: string): string {
  const gap = (weekday - dow(today) + 7) % 7;
  return addDays(today, gap === 0 ? 7 : gap);
}

/** `m0`/`d` in `year`, or this year, or next when this year's has gone by (today itself stays). */
function monthDay(m0: number, d: number, today: string, year?: number): string | null {
  if (year !== undefined) return make(year, m0, d);
  const y = +today.slice(0, 4), first = make(y, m0, d);
  return first && first >= today ? first : make(y + 1, m0, d);
}

const COUNT: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };

/** A phrase for a When choice: `today`, `tonight`/`evening`, `tomorrow`, a weekday (`fri`, `next fri`), `in 3d`
 *  / `3 days` / `+2w` / `in a month`, `next week`/`next month`, `nov 12`, `12 nov 2027`, or `2026-11-12`; a trailing
 *  `evening` makes it This Evening (`fri evening`). A date gone by this year means next year's. null when it is none of these. */
export function parseWhen(input: string, today: string): Schedule | null {
  let s = input.trim().toLowerCase().replace(/[,.]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  let evening = false;
  s = s.replace(/\bthis evening$/, "evening");
  const tail = /^(?:(.*?)\s+)?(?:evening|eve|tonight)$/.exec(s);
  if (tail) { evening = true; s = tail[1] ?? "today"; }
  const at = (when: string | null): Schedule | null => (when ? { when, evening } : null);

  if (s === "today" || s === "tod" || s === "now") return at(today);
  if (s === "tomorrow" || s === "tom" || s === "tmr" || s === "tmrw") return at(addDays(today, 1));
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return at(make(+iso[1], +iso[2] - 1, +iso[3]));

  const rel = /^(?:in\s+|\+)?(\d{1,3}|an?|one|two|three|four|five|six|seven)\s*(d|days?|w|wks?|weeks?|m|mo|mos|months?|y|yrs?|years?)$/.exec(s);
  if (rel) {
    const n = COUNT[rel[1]] ?? +rel[1], unit = rel[2][0];
    return at(unit === "d" ? addDays(today, n) : unit === "w" ? addDays(today, 7 * n) : addMonths(today, unit === "m" ? n : 12 * n));
  }
  if (s === "next week") return at(nextWeekday(1, today));
  if (s === "next month") return at(addMonths(today, 1));

  const wd = /^(?:(?:next|on|this)\s+)?([a-z]+)$/.exec(s);
  if (wd && nameIn(WEEKDAYS, wd[1]) >= 0) return at(nextWeekday(nameIn(WEEKDAYS, wd[1]), today));

  const md = /^(?:on\s+)?([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?$/.exec(s);
  const dm = /^(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})(?:\s+(\d{4}))?$/.exec(s);
  const p = md ? { m: md[1], d: md[2], y: md[3] } : dm ? { m: dm[2], d: dm[1], y: dm[3] } : null;
  if (p && nameIn(MONTHS, p.m) >= 0) return at(monthDay(nameIn(MONTHS, p.m), +p.d, today, p.y ? +p.y : undefined));
  return null;
}

/** How a stored day reads: Today, Tomorrow, Yesterday, a weekday within the week, else `Nov 3` (with the year when it
 *  is not this one). */
export function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  if (day === addDays(today, -1)) return "Yesterday";
  if (day > today && day < addDays(today, 7)) return cap(WEEKDAYS[dow(day)]);
  return day.slice(0, 4) === today.slice(0, 4) ? short(day) : `${short(day)} ${day.slice(0, 4)}`;
}

/** What a task's schedule says: `Today`, `This Evening`, `Fri evening`; null when it has none. */
export function whenLabel(s: { when?: string | null; evening?: boolean }, today: string): string | null {
  if (!s.when) return null;
  return s.evening ? (s.when === today ? "This Evening" : `${dayLabel(s.when, today)} evening`) : dayLabel(s.when, today);
}

/** A day as a group heading in Upcoming: its label and what goes beside it (the date for a weekday, the weekday for a date). */
export function dayParts(day: string, today: string): { label: string; detail: string } {
  const label = dayLabel(day, today), name = cap(WEEKDAYS[dow(day)]);
  return label === name || label === "Tomorrow" ? { label, detail: short(day) } : { label, detail: name };
}

const UNIT: Record<string, string> = { d: "day", w: "week", m: "month", y: "year" };

/** `1w` as "Every week", `2d` "Every 2 days", `+3d` "3 days after done", `mon,thu` "Every Mon, Thu". */
export function everyLabel(every: Every): string {
  if (/^[a-z]/.test(every)) return `Every ${every.split(",").map(cap).join(", ")}`;
  const m = /^(\+?)(\d+)([dwmy])$/.exec(every)!, n = +m[2], u = UNIT[m[3]], span = n === 1 ? u : `${n} ${u}s`;
  return m[1] ? `${span} after done` : n === 1 ? `Every ${u}` : `Every ${span}`;
}
