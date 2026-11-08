// Home, the first view: the day at a glance and every note. The date; then the task box (Today, the Inbox and Upcoming as
// quiet words, opening on the owner's pick (core/prefs.ts `homeList`), the one chosen in full and the others faint; its + beside it) next to the
// month of planned tasks as a heatmap; Hovering either lights or scrolls to the same day in the other; then every note as the Notes view's tiles, in a masonry a page at a time. A task opens beside its own
// list, a note over Home (which stays mounted under it). The route is routes/_app/index.tsx; a badge's tag is `?tags=`, and the task
// box's list is kept here for as long as the app is open (not in the URL: the rail's and the tabs' Home finds the
// box as it was left). The page's scroll is the router's (`data-scroll-restoration-id`, lib/scroll.ts).
// Below `md` it is the phone's Home (mobile/src/ui/home.tsx): one header row (the app's mark, which is the lens control, and the
// search button, whose drawer takes the page's place: search-drawer.tsx), the days as a strip (days.tsx) where the desktop has the
// month, the same task box at a fixed height, then the notes. The date is the desktop's; the phone's strip says the month.
import { Highlight, HighlightItem } from "@animate-ui/react/primitives/effects/highlight";
import { Days } from "@/components/days";
import { LensSwitcher } from "@/components/lens-switcher";
import { Planned } from "@/components/planned";
import { SearchDrawer } from "@/components/search-drawer";
import { TASK_ICON } from "@/components/task-icons";
import { NoteList, TOOL } from "@/components/note-list";
import { TaskList } from "@/components/task-list";
import { Button } from "@/components/ui/button";
import { addDays } from "@/core/dates";
import { useActiveLens } from "@/hooks/lens";
import { prefsNow } from "@/hooks/prefs";
import { useNarrow } from "@/hooks/media";
import { useNow } from "@/hooks/now";
import { useScrollSwitch } from "@/hooks/scroll";
import { useViews } from "@/hooks/todo";
import { useShell } from "@/hooks/shell";
import { usePlace, type TaskView } from "@/lib/nav";
import { homeScroll } from "@/lib/scroll";
import { cn } from "@/lib/utils";
import { HEADER_ICON, PageHeader } from "@/components/page-header";
import { Plus, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

const TABS = [["today", "Today"], ["inbox", "Inbox"], ["upcoming", "Upcoming"]] as const satisfies readonly [TaskView, string][];

/** Home's task box: the list in front, kept while another screen takes Home's place. */
type Box = { tab: (typeof TABS)[number][0] };
/** The box as last left, or null before it was: it opens on the owner's pick (core/prefs.ts `homeList`). */
let box: Box | null = null;

const NO_TAGS: string[] = [];

export function Home() {
  const { newNote: onNew, add: onAdd } = useShell();
  const d = new Date(useNow(60_000));
  const phone = useNarrow();
  const [searching, setSearching] = useState(false);
  const closeSearch = useCallback(() => setSearching(false), []);
  const { today } = useViews();
  // The task box's list (the lens is the only filter): kept while another tab takes Home's place, so coming back finds the
  // box as it was left
  const [tab, setTab] = useState<Box["tab"]>(() => box?.tab ?? prefsNow().homeList);
  useEffect(() => { box = { tab }; }, [tab]);
  // Home's own scroll is the router's, per tag filter and lens: another one is another list (the lens switched on the page is `useScrollSwitch`'s)
  const { view } = usePlace(), lens = useActiveLens();
  const scrollId = homeScroll(view.kind === "home" ? view.tags ?? NO_TAGS : NO_TAGS, lens?.rec);
  // A lens is switched on the page, not navigated to: Home's own scroller puts its place back (hooks/scroll.ts)
  const page = useRef<HTMLDivElement>(null);
  useScrollSwitch(page, scrollId);
  // A day picked in the planner: today's list, or Upcoming scrolled to it; `n` makes picking the same day again count
  const [focus, setFocus] = useState<{ day: string; n: number } | null>(null);
  // The day Upcoming was scrolled to by hand, which the days strip follows (phone)
  const [viewing, setViewing] = useState<string | null>(null);
  const pick = (day: string) => { setTab(day === today ? "today" : "upcoming"); setFocus(day === today ? null : { day, n: (focus?.n ?? 0) + 1 }); setViewing(null); };
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
    <PageHeader title={<LensSwitcher header />} actions={
      <Button variant="ghost" size="icon" aria-label={searching ? "Close search" : "Search"} onClick={() => setSearching((o) => !o)} className={cn(HEADER_ICON, searching && "text-brand hover:text-brand")}>
        {searching ? <X /> : <Search />}
      </Button>} />
  );
  // The phone's search comes down over the page (search-drawer.tsx), which stays laid out under it, inert, and keeps its scroll
  return (
    <main className="relative min-w-0 flex-1">
      <AnimatePresence>{phone && searching ? <motion.div key="search" className="absolute inset-0 z-10"><SearchDrawer header={top} onClose={closeSearch} /></motion.div> : null}</AnimatePresence>
      {/* The router puts the place back (lib/scroll.ts) before the masonry has settled; the browser's scroll anchoring would then
          chase the tiles as they measure and leave the page off the place. The settled layout is the one that was left, so no anchoring */}
      <div ref={page} data-scroll-restoration-id={scrollId} className="h-full overflow-y-auto [overflow-anchor:none]" inert={phone && searching}>
        {phone ? top : null}
        <div className="mx-auto max-w-6xl space-y-12 px-4 pt-8 pb-28 max-md:space-y-4 max-md:px-0 max-md:pt-2 max-md:pb-6 md:px-8">
          {phone ? null : <h1 className="text-3xl font-bold tracking-tight">{d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</h1>}

          <div className="grid items-start gap-x-14 gap-y-12 max-md:grid-cols-[minmax(0,1fr)] max-md:gap-y-2 md:grid-cols-2">
            {phone ? <Days today={today} day={tab === "today" ? today : tab === "upcoming" ? viewing ?? focus?.day ?? null : null} onPick={pick}
              onAdd={(day) => onAdd({ schedule: { when: day, evening: false } })} /> : null}
            <section aria-label="Tasks" className="@container flex min-w-0 flex-col md:h-[26rem]">
              <header className="flex items-center gap-3 pb-2 max-md:gap-2 max-md:pr-4 max-md:pl-1.5">
                <nav className="flex min-w-0 flex-1 items-center gap-0.5 sm:gap-1.5" aria-label="Task lists">
                  {/* One background glides to the list in front */}
                  <Highlight controlledItems value={tab} className="inset-0 rounded-full bg-accent">
                    {TABS.map(([k, name]) => { const Icon = TASK_ICON[k]; return (
                      <HighlightItem key={k} value={k}>
                        <button type="button" aria-current={tab === k ? "true" : undefined} onClick={() => { setTab(k); setViewing(null); if (phone) setFocus(null); }}
                          className={cn("flex items-center gap-2 rounded-full px-2.5 py-0.5 text-lg font-bold tracking-tight transition-opacity sm:text-[22px] max-md:gap-1.5 max-md:px-2 max-md:text-[17px] max-md:font-extrabold focus-visible:outline-2 focus-visible:outline-brand/60",
                            tab === k ? "text-fg" : "text-fg opacity-25 hover:opacity-55")}>
                          {tab === k ? <Icon className="size-5 text-brand max-md:size-[17px]" /> : null}{name}
                        </button>
                      </HighlightItem>
                    ); })}
                  </Highlight>
                </nav>
                <Button variant={phone ? "outline" : "ghost"} size="icon-sm" aria-label="New task" title="New task (Q)" onClick={add} className={cn("shrink-0 text-brand hover:text-brand", TOOL)}><Plus className="max-md:size-5" /></Button>
              </header>
              <div className="min-h-0 flex-1 max-md:h-72 max-md:flex-none"><TaskList key={tab} embedded view={{ kind: tab }} focus={tab === "upcoming" ? focus : null} onHoverDay={phone ? undefined : setHot} onView={phone ? setViewing : undefined} /></div>
            </section>

            {phone ? null : <Planned onPick={pick} lit={hot} onHover={peek} onAdd={(day) => onAdd({ schedule: { when: day, evening: false } })} />}
          </div>

          <NoteList onNew={onNew} scrollId={scrollId} />
        </div>
      </div>
    </main>
  );
}
