// Home, the first view: the day at a glance and every note. The date; then the task box (Today, the Inbox and Upcoming as
// quiet words, opening on the owner's pick (core/prefs.ts `homeList`), the one chosen in full and the others faint, the list picked sliding in as a tab panel; its + beside it) next to the
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
import { blur, ReducedMotionConfig, shift, transition, useTempoTransition } from "@animate-ui/react/utils/motion";
import { AnimatePresence, motion, type Transition, type Variants } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

const TABS = [["today", "Today"], ["inbox", "Inbox"], ["upcoming", "Upcoming"]] as const satisfies readonly [TaskView, string][];

/** A list taking the box's place as a tab panel does (Animate UI's `shift.tabs`, `blur.panel`): the one leaving slides away from the
 *  side of the tab picked as it fades out, then the picked one comes in from that side. `custom` is +1 for a tab to the right, -1 left. */
const panel = (panelIn: Transition, panelOut: Transition): Variants => ({
  enter: (dir: number) => ({ opacity: 0, x: dir * shift.tabs, filter: blur.panel }),
  shown: { opacity: 1, x: 0, filter: "blur(0px)", transition: panelIn },
  leave: (dir: number) => ({ opacity: 0, x: -dir * shift.tabs, filter: blur.panel, transition: panelOut }),
});
const order = (k: TaskView) => TABS.findIndex(([t]) => t === k);

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
  // Which way the list moves: toward the tab picked, from the one in front before it (set as the tab is, so the leaving list reads it too)
  const [dir, setDir] = useState(1);
  const show = (k: Box["tab"]) => { if (k !== tab) setDir(order(k) > order(tab) ? 1 : -1); setTab(k); };
  const panels = panel(useTempoTransition(transition.panelIn), useTempoTransition(transition.panelOut));
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
  const pick = (day: string) => { show(day === today ? "today" : "upcoming"); setFocus(day === today ? null : { day, n: (focus?.n ?? 0) + 1 }); setViewing(null); };
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
    <main className="relative flex h-full min-w-0 flex-1 flex-col">
      <AnimatePresence>{phone && searching ? <motion.div key="search" className="absolute inset-0 z-10"><SearchDrawer header={top} onClose={closeSearch} /></motion.div> : null}</AnimatePresence>
      {phone ? top : null}
      {/* The router puts the place back (lib/scroll.ts) before the masonry has settled; the browser's scroll anchoring would then
          chase the tiles as they measure and leave the page off the place. The settled layout is the one that was left, so no anchoring */}
      <div ref={page} data-scroll-restoration-id={scrollId} className="min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]" inert={phone && searching}>
        <div className="mx-auto max-w-6xl space-y-12 px-4 pt-8 pb-28 max-md:space-y-4 max-md:px-0 max-md:pt-2 max-md:pb-[calc(var(--under-tabs)+1.5rem)] md:px-8">
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
                        <button type="button" aria-current={tab === k ? "true" : undefined} onClick={() => { show(k); setViewing(null); if (phone) setFocus(null); }}
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
              {/* The list picked takes the box as a tab panel: the old one out first, then the new one in (no two lists scrolling at once) */}
              <div className="min-h-0 flex-1 max-md:h-72 max-md:flex-none">
                <ReducedMotionConfig>
                  <AnimatePresence mode="wait" initial={false} custom={dir}>
                    <motion.div key={tab} className="h-full" custom={dir} variants={panels} initial="enter" animate="shown" exit="leave">
                      <TaskList embedded view={{ kind: tab }} focus={tab === "upcoming" ? focus : null} onHoverDay={phone ? undefined : setHot} onView={phone ? setViewing : undefined} />
                    </motion.div>
                  </AnimatePresence>
                </ReducedMotionConfig>
              </div>
            </section>

            {phone ? null : <Planned onPick={pick} lit={hot} onHover={peek} onAdd={(day) => onAdd({ schedule: { when: day, evening: false } })} />}
          </div>

          <NoteList onNew={onNew} scrollId={scrollId} />
        </div>
      </div>
    </main>
  );
}
