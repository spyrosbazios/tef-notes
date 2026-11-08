// Home, the first view: the day at a glance and every note. The date; then the task box (Today, the Inbox and Upcoming as
// quiet words, Today first, the one chosen in full and the others faint; its tag filter and + beside them) next to the
// month of planned tasks as a heatmap; Hovering either lights or scrolls to the same day in the other; then every note as the Notes view's tiles, in a masonry a page at a time. A task opens beside its own
// list, a note on a page of its own.
// Below `md` it is the phone's Home (mobile/src/ui/home.tsx): one header row (the app's mark, which is the lens control, and the
// search button, whose drawer takes the page's place: search-drawer.tsx), the days as a strip (days.tsx) where the desktop has the
// month, the same task box at a fixed height, then the notes. The date is the desktop's; the phone's strip says the month.
import { Highlight, HighlightItem } from "@animate-ui/react/primitives/effects/highlight";
import type { Start } from "@/components/quick-add";
import { Days } from "@/components/days";
import { LensSwitcher } from "@/components/lens-switcher";
import { Planned } from "@/components/planned";
import { SearchDrawer } from "@/components/search-drawer";
import { TASK_ICON } from "@/components/task-icons";
import { NoteList, TagFilter } from "@/components/note-list";
import { TaskList } from "@/components/task-list";
import { Button } from "@/components/ui/button";
import { addDays } from "@/core/dates";
import { useNarrow } from "@/hooks/media";
import { useNow } from "@/hooks/now";
import { useViews } from "@/hooks/todo";
import type { TaskView } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const TABS = [["today", "Today"], ["inbox", "Inbox"], ["upcoming", "Upcoming"]] as const satisfies readonly [TaskView, string][];

export function Home({ onNew, onAdd }: { onNew: () => void; onAdd: (s: Start) => void }) {
  const d = new Date(useNow(60_000));
  const phone = useNarrow();
  const [searching, setSearching] = useState(false);
  const closeSearch = useCallback(() => setSearching(false), []);
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

  // The phone's header: the mark is the lens (picked here only: a filter on the whole app), the corner opens and closes Search
  const top = (
    <div className="flex h-11 items-center gap-1 pr-2 pl-4">
      <div className="flex min-w-0 flex-1"><LensSwitcher header /></div>
      <Button variant="ghost" size="icon" aria-label={searching ? "Close search" : "Search"} onClick={() => setSearching((o) => !o)} className={searching ? "text-brand hover:text-brand" : "text-dim"}>
        {searching ? <X className="size-[22px]" /> : <Search className="size-[22px]" />}
      </Button>
    </div>
  );
  if (phone && searching) return <SearchDrawer header={top} onClose={closeSearch} />;

  return (
    <div className="h-full overflow-y-auto">
      {phone ? top : null}
      <div className="mx-auto max-w-6xl space-y-12 px-4 pt-8 pb-28 max-md:space-y-4 max-md:px-0 max-md:pt-2 max-md:pb-6 md:px-8">
        {phone ? null : <h1 className="text-3xl font-bold tracking-tight">{d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</h1>}

        <div className="grid items-start gap-x-14 gap-y-12 max-md:grid-cols-[minmax(0,1fr)] max-md:gap-y-2 md:grid-cols-2">
          {phone ? <Days today={today} day={tab === "today" ? today : tab === "upcoming" ? focus?.day ?? null : null} onPick={pick}
            onAdd={(day) => onAdd({ schedule: { when: day, evening: false } })} /> : null}
          <section aria-label="Tasks" className="@container flex min-w-0 flex-col md:h-[26rem]">
            <header className="flex items-center gap-3 pb-2 max-md:pr-2 max-md:pl-1.5">
              <nav className="flex min-w-0 flex-1 items-center gap-0.5 sm:gap-1.5" aria-label="Task lists">
                {/* One background glides to the list in front */}
                <Highlight controlledItems value={tab} className="inset-0 rounded-full bg-accent">
                  {TABS.map(([k, name]) => { const Icon = TASK_ICON[k]; return (
                    <HighlightItem key={k} value={k}>
                      <button type="button" aria-current={tab === k ? "true" : undefined} onClick={() => { setTab(k); if (phone) setFocus(null); }}
                        className={cn("flex items-center gap-2 rounded-full px-2.5 py-0.5 text-lg font-bold tracking-tight transition-opacity sm:text-[22px] max-md:gap-1.5 max-md:px-2 max-md:text-[17px] max-md:font-extrabold focus-visible:outline-2 focus-visible:outline-brand/60",
                          tab === k ? "text-fg" : "text-fg opacity-25 hover:opacity-55")}>
                        {tab === k ? <Icon className="size-5 text-brand max-md:size-[17px]" /> : null}{name}
                      </button>
                    </HighlightItem>
                  ); })}
                </Highlight>
              </nav>
              <TagFilter what="Tasks" counts={counts} chosen={tags} onChange={setTags} />
              <Button variant="ghost" size="icon-sm" aria-label="New task" title="New task (Q)" onClick={add} className="shrink-0 text-brand hover:text-brand"><Plus className="max-md:size-[22px]" /></Button>
            </header>
            <div className="min-h-0 flex-1 max-md:h-72 max-md:flex-none"><TaskList key={tab} embedded view={{ kind: tab }} tags={tags} focus={tab === "upcoming" ? focus : null} onHoverDay={phone ? undefined : setHot} /></div>
          </section>

          {phone ? null : <Planned onPick={pick} lit={hot} onHover={peek} onAdd={(day) => onAdd({ schedule: { when: day, evening: false } })} />}
        </div>

        <NoteList onNew={onNew} />
      </div>
    </div>
  );
}
