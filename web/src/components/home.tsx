// Home, the first view: the day at a glance and every note. The date; then the task box (Today, the Inbox and Upcoming as
// quiet words, Today first, the one chosen in full and the others faint; its tag filter and + beside them) next to the
// month of planned tasks as a heatmap; Hovering either lights or scrolls to the same day in the other; then every note as the Notes view's tiles, in a masonry a page at a time. A task opens beside its own
// list, a note on a page of its own.
import type { Start } from "@/components/quick-add";
import { Planned } from "@/components/planned";
import { TASK_ICON } from "@/components/task-icons";
import { NoteList, TagFilter } from "@/components/note-list";
import { TaskList } from "@/components/task-list";
import { Button } from "@/components/ui/button";
import { addDays } from "@/core/dates";
import { useNow } from "@/hooks/now";
import { useViews } from "@/hooks/todo";
import type { TaskView } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const TABS = [["today", "Today"], ["inbox", "Inbox"], ["upcoming", "Upcoming"]] as const satisfies readonly [TaskView, string][];

export function Home({ onNew, onAdd }: { onNew: () => void; onAdd: (s: Start) => void }) {
  const d = new Date(useNow(60_000));
  const { views, today } = useViews();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("today");
  // The task box's own tag filter, over its three lists; the notes below keep theirs
  const [tags, setTags] = useState<string[]>([]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of [...views.today, ...views.evening, ...views.inbox, ...views.upcoming.flatMap((g) => g.tasks)]) for (const g of t.tags) m.set(g, (m.get(g) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [views]);
  // A day picked in the planner: today's list, or Upcoming scrolled to it; `n` makes picking the same day again count
  const [focus, setFocus] = useState<{ day: string; n: number } | null>(null);
  const pick = (day: string) => { setTab(day === today ? "today" : "upcoming"); setFocus(day === today ? null : { day, n: (focus?.n ?? 0) + 1 }); };
  // Planner and task box follow each other on hover: a planner day scrolls Upcoming to it (after a short rest, so a pointer
  // crossing the month doesn't drag the list along), and a row or Upcoming day lights its day in the planner
  const [hot, setHot] = useState<string | null>(null);
  const rest = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(rest.current), []);
  const peek = (day: string | null) => {
    window.clearTimeout(rest.current);
    if (!day || tab !== "upcoming" || day <= today) return;
    rest.current = window.setTimeout(() => setFocus((f) => (f?.day === day ? f : { day, n: (f?.n ?? 0) + 1 })), 120);
  };
  const add = () => onAdd({ schedule: tab === "inbox" ? null : { when: tab === "today" ? today : addDays(today, 1), evening: false } });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-12 px-4 pt-8 pb-28 md:px-8">
        <h1 className="text-3xl font-bold tracking-tight">{d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</h1>

        <div className="grid items-start gap-x-14 gap-y-12 md:grid-cols-2">
          <section aria-label="Tasks" className="flex h-[26rem] min-w-0 flex-col">
            <header className="flex items-center gap-3 pb-2 pl-3">
              <nav className="flex min-w-0 flex-1 items-center gap-5" aria-label="Task lists">
                {TABS.map(([k, name]) => { const Icon = TASK_ICON[k]; return (
                  <button key={k} type="button" aria-current={tab === k ? "true" : undefined} onClick={() => setTab(k)}
                    className={cn("flex items-center gap-2 text-[22px] font-bold tracking-tight transition-opacity focus-visible:outline-2 focus-visible:outline-brand/60 rounded-sm",
                      tab === k ? "text-fg" : "text-fg opacity-25 hover:opacity-55")}>
                    {tab === k ? <Icon className="size-5 text-brand" /> : null}{name}
                  </button>
                ); })}
              </nav>
              <TagFilter what="Tasks" counts={counts} chosen={tags} onChange={setTags} />
              <Button variant="ghost" size="icon-sm" aria-label="New task" title="New task (Q)" onClick={add} className="shrink-0 text-brand hover:text-brand"><Plus /></Button>
            </header>
            <div className="min-h-0 flex-1"><TaskList key={tab} embedded view={{ kind: tab }} tags={tags} focus={tab === "upcoming" ? focus : null} onHoverDay={setHot} /></div>
          </section>

          <Planned onPick={pick} lit={hot} onHover={peek} onAdd={(day) => onAdd({ schedule: { when: day, evening: false } })} />
        </div>

        <NoteList onNew={onNew} />
      </div>
    </div>
  );
}
