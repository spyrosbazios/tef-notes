// Home's planner heatmap (the month and its counts: core/planner.ts, shared with the phone): a month of days, Monday first, each shaded by how many open tasks are planned for it (its `when`)
// or due on it, inside the lens that is on. The arrows step back and ahead a month; the month's name goes back to this one.
// A day's tooltip lists its tasks (evening, due, tags); past days stay faint. Clicking a day shows it in the task box (Today's
// list for today, Upcoming's day for a later one); the + a tile shows on hover adds a task planned for that day. Shades are the brand at four fixed strengths: 1, 2, 3, 4 or more.
import { dayDate as at, monthDays, monthLoad, monthOf, plannedByDay, shadeOf, WEEKDAYS } from "@/core/planner";
import { useLensTasks, useToday } from "@/hooks/todo";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CalendarDays, ChevronLeft, ChevronRight, Circle, Flag, Moon, Plus } from "lucide-react";
import { useMemo, useState } from "react";

/** core/planner.ts's shades, none to four or more. */
const SHADE = ["bg-fg/[0.04]", "bg-brand/20", "bg-brand/40", "bg-brand/65", "bg-brand"] as const;
const SHOWN = 5;

/** `lit`: the day of the task hovered in the task box, ringed here (and its month shown); `onHover`: the day under the pointer, null as it leaves. */
export function Planned({ onPick, onAdd, lit = null, onHover }: { onPick: (day: string) => void; onAdd: (day: string) => void; lit?: string | null; onHover?: (day: string | null) => void }) {
  const today = useToday();
  const tasks = useLensTasks().data;
  const [shift, setShift] = useState(0);
  const first = monthOf(today, shift);
  // A hovered task in another month brings that month up while it's hovered; the arrows' month comes back after
  const shown = lit && lit.slice(0, 7) !== first.slice(0, 7) && lit >= today.slice(0, 8) + "01" ? lit.slice(0, 8) + "01" : first;

  const byDay = useMemo(() => plannedByDay(tasks), [tasks]);
  const days = useMemo(() => monthDays(shown), [shown]);
  const { total, busiest } = monthLoad(days, byDay);

  return (
    <section aria-label="Planned" className="flex h-[26rem] min-w-0 flex-col">
      <header className="flex items-center gap-1 pb-3">
        <button type="button" onClick={() => setShift(0)} title="This month"
          className="mr-auto flex items-center gap-2 rounded-sm text-[22px] font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-brand/60">
          <CalendarDays className="size-5 text-brand" />
          {at(shown).toLocaleDateString(undefined, { month: "long", ...(shown.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }) })}
        </button>
        <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => setShift(shift - 1)} className="text-dim"><ChevronLeft /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => setShift(shift + 1)} className="text-dim"><ChevronRight /></Button>
      </header>

      <div onMouseLeave={onHover ? () => onHover(null) : undefined} className="grid min-h-0 flex-1 grid-cols-7 gap-1.5" style={{ gridTemplateRows: `auto repeat(${days.length / 7}, minmax(0, 1fr))` }}>
        {WEEKDAYS.map((w) => <span key={w} className="pb-0.5 text-center text-[11px] font-medium text-faint">{w}</span>)}
        <TooltipProvider delayDuration={80}>
          {days.map((d, i) => {
            if (!d) return <span key={i} />;
            const list = byDay.get(d) ?? [], n = list.length, past = d < today;
            const tile = (
              <button type="button" onClick={() => onPick(d)} onMouseEnter={onHover ? () => onHover(d) : undefined} disabled={past} aria-label={`${at(d).toLocaleDateString(undefined, { day: "numeric", month: "long" })}, ${n} planned`}
                className={cn("flex size-full items-start justify-end rounded-lg p-1.5 text-[11px] leading-none tabular-nums transition-transform duration-150 focus-visible:outline-2 focus-visible:outline-brand/60",
                  SHADE[shadeOf(n)], n >= 3 ? "text-primary-foreground" : "text-dim", !past && "cursor-pointer hover:brightness-110", past && "opacity-40",
                  d === today && "font-semibold text-fg ring-2 ring-brand ring-offset-1 ring-offset-bg",
                  d === lit && "scale-110 font-semibold ring-2 ring-fg/70 ring-offset-1 ring-offset-bg")}>
                {Number(d.slice(8))}
              </button>
            );
            return (
              <div key={d} className="group relative min-h-0">
                {n ? (
                  <Tooltip>
                    <TooltipTrigger asChild>{tile}</TooltipTrigger>
                    <TooltipContent side="top" sideOffset={6} className="block w-64 max-w-64 p-0">
                      <p className="flex items-baseline justify-between gap-2 border-b border-background/15 px-3 py-2">
                        <span className="font-semibold">{at(d).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}</span>
                        <span className="opacity-60">{n} {n === 1 ? "task" : "tasks"}</span>
                      </p>
                      <ul className="space-y-1.5 px-3 py-2">
                        {list.slice(0, SHOWN).map((t) => (
                          <li key={t.id} className="flex items-start gap-2">
                            <Circle className="mt-px size-3 shrink-0 opacity-50" />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1">
                                <span className="truncate">{t.title || "Untitled"}</span>
                                {t.evening && t.when === d ? <Moon className="size-3 shrink-0 opacity-60" /> : null}
                                {t.due === d ? <Flag className="size-3 shrink-0 text-warn" /> : null}
                              </span>
                              {t.tags.length ? <span className="block truncate text-[10px] opacity-55">{t.tags.map((g) => `#${g}`).join(" ")}</span> : null}
                            </span>
                          </li>
                        ))}
                        {n > SHOWN ? <li className="pl-5 opacity-55">and {n - SHOWN} more</li> : null}
                      </ul>
                    </TooltipContent>
                  </Tooltip>
                ) : tile}
                {past ? null : (
                  <button type="button" onClick={() => onAdd(d)} aria-label="New task on this day" title="New task on this day"
                    className="absolute bottom-1 left-1 grid size-5 place-items-center rounded-sm bg-brand text-primary-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100">
                    <Plus className="size-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </TooltipProvider>
      </div>

      <footer className="flex items-center justify-between gap-3 pt-3 text-[11px] text-faint">
        <p>{total ? <><span className="font-semibold tabular-nums text-fg">{total}</span> planned{busiest > 1 ? <>, up to <span className="font-semibold tabular-nums text-fg">{busiest}</span> a day</> : null}</> : "Nothing planned this month"}</p>
        <div className="flex items-center gap-1" aria-hidden>
          Fewer{SHADE.map((s) => <span key={s} className={cn("size-2 rounded-[2px]", s)} />)}More
        </div>
      </footer>
    </section>
  );
}
