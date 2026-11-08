// Home's days on a phone (mobile/src/ui/days.tsx): the month planner (planned.tsx) as a strip of days scrolled sideways past
// one fixed slot in the middle, a week behind today to half a year ahead. Whatever day sits in the slot is the day the task box
// shows (Today's list for today, Upcoming's day for a later one): drag the strip to put a day there, or tap one and it slides
// in; the box's own `day` slides the strip to it, so the two stay in step. Each day is shaded by how many open tasks are planned
// for it or due on it, inside the lens that is on (core/planner.ts, shared with the month): the brand at 1, 2, 3, 4 or more.
// Holding a day adds a task planned for it. Past days stay faint and take neither: a drag that leaves one in the slot settles
// back on today. The strip snaps (CSS scroll-snap), and a day grows as it nears the slot and fades as it leaves.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addDays, daysBetween } from "@/core/dates";
import { dayDate, dayRange, plannedByDay, shadeOf, WEEKDAYS } from "@/core/planner";
import { useLongPress } from "@/hooks/long-press";
import { useLensTasks } from "@/hooks/todo";
import { SHADE } from "@/lib/shade";
import { cn } from "@/lib/utils";

const BEHIND = 7, AHEAD = 183;
const CELL = 52, GAP = 6, STEP = CELL + GAP;

const monthOf = (day: string, today: string) =>
  dayDate(day).toLocaleDateString(undefined, day.slice(0, 4) === today.slice(0, 4) ? { month: "long" } : { month: "long", year: "numeric" });

/** One day of the strip. `near`: how many steps it is from the slot (0 in it), at most 4: it grows toward the slot and fades away from it. */
const Day = memo(function Day({ day, n, near, today, picked, onPick, onAdd }: {
  day: string; n: number; near: number; today: string; picked: boolean; onPick: (day: string) => void; onAdd: (day: string) => void;
}) {
  const past = day < today, on = day === today;
  const press = useLongPress(() => { if (!past) onAdd(day); });
  const scale = near === 0 ? "scale-110" : near === 1 ? "scale-95" : near >= 3 ? "scale-[0.86]" : "scale-90";
  return (
    <div className={cn("snap-center shrink-0 rounded-xl border-2 transition-[transform,opacity,border-color] duration-150", scale,
      past ? "opacity-35" : near === 0 ? "opacity-100" : near === 1 ? "opacity-85" : near >= 4 ? "opacity-55" : "opacity-70",
      picked ? "border-brand" : near === 0 ? "border-fg/30" : "border-transparent")} style={{ width: CELL, height: 56 }}>
      <button type="button" {...press} disabled={past} onClick={() => onPick(day)} aria-current={picked ? "date" : undefined}
        aria-label={`${dayDate(day).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}, ${n} planned`}
        className={cn("flex size-full flex-col items-center justify-center rounded-[10px] select-none active:opacity-70", SHADE[shadeOf(n)], n >= 3 ? "text-primary-foreground" : on ? "text-brand" : "text-dim")}>
        <span className="text-[11px] leading-none font-medium opacity-80">{WEEKDAYS[(dayDate(day).getDay() + 6) % 7]}</span>
        <span className={cn("text-[17px] leading-tight tabular-nums", on ? "font-bold" : "font-medium")}>{Number(day.slice(8))}</span>
      </button>
    </div>
  );
});

/** `day`: the day the task box shows (null while it shows the Inbox); the strip slides it into the slot. */
export function Days({ today, day: picked, onPick, onAdd }: { today: string; day: string | null; onPick: (day: string) => void; onAdd: (day: string) => void }) {
  const tasks = useLensTasks().data;
  const days = useMemo(() => dayRange(addDays(today, -BEHIND), BEHIND + AHEAD), [today]);
  const byDay = useMemo(() => plannedByDay(tasks), [tasks]);
  const strip = useRef<HTMLDivElement>(null);
  const [slot, setSlot] = useState(BEHIND);     // the day in the slot, followed live for the month's name and each day's size
  const slide = useCallback((day: string, smooth = true) => {
    strip.current?.scrollTo({ left: Math.min(days.length - 1, Math.max(0, daysBetween(days[0], day))) * STEP, behavior: smooth ? "smooth" : "instant" });
  }, [days]);

  // The callbacks as the days see them never change, so a Home render leaves every mounted day alone; the box's day, as the settling sees it
  const latest = useRef({ onPick, onAdd, picked });
  useEffect(() => { latest.current = { onPick, onAdd, picked }; });
  const pickDay = useCallback((d: string) => latest.current.onPick(d), []);
  const addDay = useCallback((d: string) => latest.current.onAdd(d), []);

  useLayoutEffect(() => { slide(latest.current.picked ?? today, false); }, [slide, today]);        // first drawn on the box's day (today at the start), no scroll to see
  useEffect(() => { if (picked) slide(picked); }, [picked, slide]);

  // The slot follows the scroll; once it stops the day in it becomes the box's (a past one settles back on today)
  const rest = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(rest.current), []);
  const scrolled = () => {
    const el = strip.current;
    if (!el) return;
    const i = Math.min(days.length - 1, Math.max(0, Math.round(el.scrollLeft / STEP)));
    setSlot(i);
    window.clearTimeout(rest.current);
    rest.current = window.setTimeout(() => {
      const d = days[i];
      if (d < today) slide(today);
      else if (d !== latest.current.picked) latest.current.onPick(d);
    }, 140);
  };

  return (
    <div className="mx-3 min-w-0" role="group" aria-label="The days' plan">
      <p className="h-[18px] text-center text-[11px] font-medium text-faint">{monthOf(days[slot], today)}</p>
      <div className="relative">
        <div ref={strip} onScroll={scrolled} style={{ gap: GAP, paddingInline: `calc(50% - ${CELL / 2}px)` }}
          className="flex snap-x snap-mandatory items-center overflow-x-auto overscroll-x-contain py-[5px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {days.map((d, i) => <Day key={d} day={d} n={byDay.get(d)?.length ?? 0} near={Math.min(4, Math.abs(i - slot))} today={today} picked={d === picked} onPick={pickDay} onAdd={addDay} />)}
        </div>
        {/* The strip's edges fade into the page rather than cutting a day in half */}
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-7 bg-linear-to-r from-bg to-transparent" />
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-7 bg-linear-to-l from-bg to-transparent" />
      </div>
    </div>
  );
}
