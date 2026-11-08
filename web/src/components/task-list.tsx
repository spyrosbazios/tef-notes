// The list column of a task view: a Things list (Inbox, Today, Upcoming, Logbook, as core/todo.ts views
// sorts them). A task just ticked stays a moment, faded, and then leaves
// (hooks/linger.ts), at the place it had.
// The list stays the same list as it changes (interactions/list.md of the animate-ui skill): a row added rises in, one removed
// (ticked and lingered, deleted, moved elsewhere) fades out of the flow at once and the rest close the gap, a dropped row's
// neighbours glide to their places. A change of view, lens or tag filter is a new list: it replaces the old one, no cascade.
import { useQueryClient } from "@tanstack/react-query";
import { Highlight, HighlightItem } from "@animate-ui/react/primitives/effects/highlight";
import { ScrollFade } from "@animate-ui/react/primitives/effects/scroll-fade";
import { ReducedMotionConfig, spring, transition, useTempoTransition } from "@animate-ui/react/utils/motion";
import { AnimatePresence, motion, useIsPresent, type Transition } from "motion/react";
import { Moon, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { dayLabel, dayParts } from "@/core/dates";
import type { Link } from "@/core/record-links";
import { dateOf } from "@/core/things";
import { landing, reorder } from "@/core/task-order";
import { matchesTags } from "@/core/tags";
import { views as viewsOf, type Task, type Views } from "@/core/todo";
import { TASK_ICON } from "@/components/task-icons";
import { DeleteTask } from "@/components/task-delete";
import { TaskRowView } from "@/components/task-row";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { useRowDrag } from "@/hooks/drag";
import { toggleTask, useLingering } from "@/hooks/linger";
import { useActiveLens } from "@/hooks/lens";
import { useLinks } from "@/hooks/links";
import { calm, useNarrow } from "@/hooks/media";
import { useNotes } from "@/hooks/notes";
import { useScrollMemory } from "@/hooks/scroll-memory";
import { editTask, useTasks, useViews } from "@/hooks/todo";
import { noteSummary } from "@/lib/links";
import { hrefOf, TASK_VIEWS, titleOf, useNav, type TaskView } from "@/lib/nav";
import { report } from "@/lib/report";
import { scheduleOf } from "@/lib/schedule";
import { scrollKey } from "@/lib/scroll-memory";
import { cn } from "@/lib/utils";

const EMPTY: Record<TaskView, string> = {
  inbox: "Nothing waiting. New tasks land here.",
  today: "Nothing for today.",
  upcoming: "Nothing scheduled ahead.",
  logbook: "Nothing done yet.",
};

const NO_LINKS: Link[] = [];
const NO_TAGS: string[] = [];

/** A day's heading counts as the list's top once it is this far (px) below the box's top edge: its own margin and a little more. */
const HEADING_REACH = 44;

/** The Logbook shows this many of the latest, as the phone's does. */
const LOGBOOK = 100;

/** What a view lists, in the order its rows sit in. */
const listOf = (v: Views, kind: TaskView): Task[] =>
  kind === "today" ? [...v.today, ...v.evening] : kind === "upcoming" ? v.upcoming.flatMap((g) => g.tasks) : kind === "logbook" ? v.logbook.slice(0, LOGBOOK) : v[kind];
type Section = { key: string; rows: Task[] };

/** Which section of the view a task sits in: Today's two, Upcoming's days, the Logbook's days; the rest are one. */
const sectionOf = (kind: TaskView, t: Task) => (kind === "today" ? (t.evening ? "evening" : "today") : kind === "upcoming" ? t.when : kind === "logbook" ? t.done : "");

/** A section's title over a hairline, as the phone draws it: This Evening, a day. */
const heading = "mx-3 mt-5 mb-1 flex items-baseline gap-2 border-b border-line pb-2 transition-colors duration-700";

function Heading({ kind, section, today, lit }: { kind: TaskView; section: string; today: string; lit?: boolean }) {
  const move = useTempoTransition(spring.reflow);
  const glide = { layout: "position", transition: move } as const;
  if (kind === "today" && section === "evening") return <motion.h3 {...glide} className={cn(heading, "items-center")}><Moon className="size-3.5 self-center text-brand" /><span className="text-[15px] font-extrabold">This Evening</span></motion.h3>;
  if (kind === "upcoming") { const p = dayParts(section, today); return <motion.h3 {...glide} data-day={section} className={cn(heading, "scroll-mt-4", lit && "text-brand")}><span className="text-[15px] font-extrabold">{p.label}</span><span className="text-xs text-dim">{p.detail}</span></motion.h3>; }
  if (kind === "logbook") return <motion.h3 {...glide} className={heading}><span className="text-[15px] font-extrabold">{section ? dayLabel(section, today) : "Earlier"}</span></motion.h3>;
  return null;
}

/** The lists as tabs, below `md` where the rail is a drawer: Inbox and Today with their counts, as the phone's Tasks tab. */
/** A section of rows. When the last of its rows goes the whole section fades out: it is inert from then on and hands the focus to the list. */
function Section({ day, fade, children }: { day?: string; fade: Transition; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null), present = useIsPresent();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!present && el.contains(document.activeElement)) el.closest<HTMLElement>("[data-task-list]")?.focus({ preventScroll: true });
    el.inert = !present;
  }, [present]);
  return (
    <motion.div ref={ref} data-section-day={day} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: fade }} exit={{ opacity: 0, transition: fade }}>
      {children}
    </motion.div>
  );
}

function Tabs({ kind, inbox, today }: { kind: TaskView; inbox: number; today: number }) {
  const { goView } = useNav();
  const count = { inbox, today, upcoming: 0, logbook: 0 };
  return (
    <nav aria-label="Lists" className="flex gap-1 overflow-x-auto border-b border-line px-3 md:hidden">
      {/* One underline glides to the list in front, as Home's tabs do */}
      <Highlight controlledItems value={kind} className="inset-x-0 top-auto bottom-0 h-0.5 rounded-none bg-brand">
        {TASK_VIEWS.map((k) => (
          <HighlightItem key={k} value={k} className="-mb-px shrink-0">
            <button type="button" aria-current={k === kind ? "page" : undefined} onClick={() => goView({ kind: k })}
              className={cn("flex h-10 items-center gap-1.5 px-2.5 text-sm font-semibold transition-colors", k === kind ? "text-fg" : "text-dim")}>
              {titleOf({ kind: k })}{count[k] ? <span className="text-xs font-normal tabular-nums text-faint">{count[k]}</span> : null}
            </button>
          </HighlightItem>
        ))}
      </Highlight>
    </nav>
  );
}

/** `embedded`: a list inside Home's task box, which draws the heading and the +: no header, no frame, scrolling inside the box's
 * fixed height, a row opening beside its own list rather than Home's. `tags`: only tasks carrying every one (Home's filter).
 * `focus`: a day Home's planner picked or is hovering: scrolled to that day (or the next one with tasks), its heading lit.
 * `onHoverDay`: the day of the row or Upcoming day under the pointer (a row's `when`, else its due), null as it leaves.
 * `onView`: Upcoming scrolled by hand: the day whose section is at the top of the list, reported as it changes (the phone's strip follows). */
export function TaskList({ view, onAdd, embedded = false, tags = NO_TAGS, focus = null, onHoverDay, onView }: { view: { kind: TaskView }; onAdd?: () => void; embedded?: boolean; tags?: string[]; focus?: { day: string; n: number } | null; onHoverDay?: (day: string | null) => void; onView?: (day: string) => void }) {
  const qc = useQueryClient();
  const { views, today, isPending } = useViews();
  const notes = useNotes().data, links = useLinks().data ?? NO_LINKS;
  const { openTask, showTask, task: open } = useNav();
  const lingering = useLingering();
  const records = useTasks().data;
  const narrow = useNarrow();
  const [deleting, setDeleting] = useState<string | null>(null);
  const doomed = (deleting && records?.find((r) => r.id === deleting)) || null;
  const kind = view.kind;
  const lens = useActiveLens(), fade = useTempoTransition(transition.fade);
  // Kept where it was left: Home's box per list, a view's own list per view. On a phone a task open takes the list's place (it is hidden)
  const scroller = useScrollMemory<HTMLDivElement>(scrollKey(embedded ? `box:${kind}` : hrefOf(view), lens?.rec), !(narrow && !embedded && open));
  // What the list is of: when it changes the rows are a new list, not rows coming and going
  const of = `${kind}|${lens?.rec ?? ""}|${tags.join(",")}`;

  const noteTitles = useMemo(() => new Map((notes ?? []).map((n) => [n.rec, n.note.title])), [notes]);

  const tagged = useMemo(() => (t: Task) => matchesTags(t.tags, tags, true), [tags]);
  const base = useMemo(() => listOf(views, kind).filter(tagged), [views, kind, tagged]);

  // The list in its sections, with each task still lingering slipped back in where it was: in its section, by `order`
  const sections = useMemo((): Section[] => {
    const m = new Map<string, Task[]>();
    for (const t of base) { const k = sectionOf(kind, t); m.set(k, [...(m.get(k) ?? []), t]); }
    const have = new Set(base.map((t) => t.id));
    for (const { task: t } of lingering.values()) {
      const was = listOf(viewsOf([t], today), kind).length > 0;
      if (have.has(t.id) || !was || !tagged(t)) continue;
      const k = sectionOf(kind, t), rows = [...(m.get(k) ?? [])], at = kind === "logbook" ? rows.findIndex((r) => r.done < t.done) : rows.findIndex((r) => r.order > t.order);
      rows.splice(at < 0 ? rows.length : at, 0, t);
      m.set(k, rows);
    }
    const out = [...m].map(([key, rows]) => ({ key, rows }));
    return kind === "today" ? out.sort((a, b) => (a.key === "today" ? -1 : b.key === "today" ? 1 : 0)) : out;
  }, [base, lingering, kind, today, tagged]);
  const byId = useMemo(() => new Map(sections.flatMap((x) => x.rows.map((t) => [t.id, t] as const))), [sections]);
  const hovered = useRef<string | null>(null);
  const hover = (day: string | null) => { if (day !== hovered.current) { hovered.current = day; onHoverDay?.(day); } };
  const dayUnder = (target: EventTarget) => {
    const el = target instanceof Element ? target : null;
    const t = byId.get(el?.closest("[data-task]")?.getAttribute("data-task") ?? "");
    return (t ? t.when || t.due : el?.closest("[data-section-day]")?.getAttribute("data-section-day")) || null;
  };
  const count = sections.reduce((n, s) => n + s.rows.length, 0);
  const lit = focus ? sections.find((x) => x.key >= focus.day)?.key : undefined;
  // The section at the top of the box while the owner scrolls Upcoming. A scroll the owner did not start (the one to a picked day) is not
  // reported, or the strip and the list would chase each other; a hand on the list (finger, wheel, key) starts reporting, the scroll
  // to a picked day stops it.
  const byHand = useRef(false), viewed = useRef<string | null>(null), seen = useRef(onView);
  useEffect(() => { seen.current = onView; });
  const watching = !!onView && kind === "upcoming";
  useEffect(() => {
    const box = scroller.current;
    if (!watching || !box) return;
    const hand = () => { byHand.current = true; };
    let raf = 0;
    const look = () => {
      raf = 0;
      if (!byHand.current) return;
      const top = box.getBoundingClientRect().top;
      let day: string | undefined, best = -Infinity;
      for (const h of box.querySelectorAll<HTMLElement>("[data-day]")) {
        const y = h.getBoundingClientRect().top - top;
        if (y <= HEADING_REACH && y > best) { best = y; day = h.dataset.day; }
      }
      if (day && day !== viewed.current) { viewed.current = day; seen.current?.(day); }
    };
    const scrolled = () => { if (!raf) raf = requestAnimationFrame(look); };
    const hands = ["touchstart", "wheel", "keydown"] as const;
    for (const t of hands) box.addEventListener(t, hand, { passive: true });
    box.addEventListener("scroll", scrolled, { passive: true });
    return () => { cancelAnimationFrame(raf); for (const t of hands) box.removeEventListener(t, hand); box.removeEventListener("scroll", scrolled); };
  }, [watching, scroller]);
  useEffect(() => {
    if (!focus || !lit) return;
    byHand.current = false;
    viewed.current = null;
    // Only the list's own box scrolls, never the page around it
    const id = requestAnimationFrame(() => {
      const box = scroller.current, el = box?.querySelector(`[data-day="${lit}"]`);
      if (box && el) box.scrollTo({ top: box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top, behavior: calm() ? "instant" : "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [focus, lit, scroller]);

  // Dragging a row within its section writes `order` as the phone does (core/task-order.ts), each at its rev. Upcoming and
  // the Logbook are sorted by day, so those stay as they are.
  const reorderable = kind === "inbox" || kind === "today";
  const rowDrag = useRowDrag((group, id, over, after) => {
    const rows = sections.find((s) => s.key === group)?.rows ?? [];
    const from = rows.findIndex((r) => r.id === id), at = rows.findIndex((r) => r.id === over);
    if (from < 0 || at < 0) return;
    report(Promise.all(reorder(rows, from, landing(from, at, after)).map((w) => editTask(qc, w.id, { order: w.order }))));
  });

  /** A row in `section`. */
  const row = (t: Task, section: string) => {
    const l = lingering.get(t.id), checked = l ? l.checked : !!t.done;
    return (
      <TaskRowView key={t.id} task={t} today={today} checked={checked} leaving={!!l} selected={open === t.id} doomed={deleting === t.id}
        notes={noteSummary(links, t.id, noteTitles)}
        showWhen={kind === "today" && !!t.when && t.when < today}
        drag={reorderable && !l ? rowDrag(section, t.id) : undefined}
        onTick={() => { void toggleTask(qc, t); }} onOpen={() => (embedded ? showTask(view, t.id) : openTask(t.id))}
        onSchedule={(s) => report(editTask(qc, t.id, scheduleOf(s)))} onDue={(d) => report(editTask(qc, t.id, { due: d ?? "" }))} onDelete={() => setDeleting(t.id)} />
    );
  };

  const Icon = TASK_ICON[kind];
  const title = titleOf(view);
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={title}>
      {embedded ? null : (
        <header className="flex items-start justify-between px-4 pt-4 pb-2">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-[22px] font-bold tracking-tight"><Icon className="size-5 text-brand" />{title}</h2>
            {kind === "today" ? <p className="pl-7 text-sm text-dim">{dateOf(today).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p> : null}
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="New task" title="New task (Q)" onClick={onAdd} className="mt-0.5 shrink-0 text-dim"><Plus /></Button>
        </header>
      )}
      {embedded ? null : <Tabs kind={kind} inbox={views.inbox.length} today={views.today.length + views.evening.length} />}
      {/* The list fades into the page where rows are scrolled out of view (top and bottom), rather than cutting one in half */}
      <ScrollFade asChild size={48} shrink={0} blur={0}>
      <div ref={scroller} data-task-list tabIndex={-1} onMouseOver={onHoverDay ? (e) => hover(dayUnder(e.target)) : undefined} onMouseLeave={onHoverDay ? () => hover(null) : undefined}
        // Focus is the hover of a finger and a keyboard: a tapped or tabbed row lights its day too, until focus leaves the list
        onFocus={onHoverDay ? (e) => hover(dayUnder(e.target)) : undefined}
        onBlur={onHoverDay ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) hover(null); } : undefined}
        className={cn("min-h-0 flex-1 overflow-y-auto outline-none", embedded ? "pb-2" : "px-2 pb-24")}>
        {isPending ? <div className="space-y-2 px-2 pt-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10 rounded-xl" />)}</div> : (
          <ReducedMotionConfig>
            <div key={of} className="relative">
              <AnimatePresence mode="popLayout" initial={false}>
                {count ? sections.map(({ key, rows }) => (
                  <Section key={key} day={kind === "upcoming" ? key : undefined} fade={fade}>
                    <Heading kind={kind} section={key} today={today} lit={key === lit} />
                    <ul className="relative"><AnimatePresence mode="popLayout" initial={false}>{rows.map((t) => row(t, key))}</AnimatePresence></ul>
                  </Section>
                )) : (
                  <motion.div key="empty" className={cn("grid place-items-center gap-3 px-6 text-center", embedded ? "py-10" : "py-16")}
                    initial={{ opacity: 0 }} animate={{ opacity: 1, transition: fade }} exit={{ opacity: 0, transition: fade }}>
                    <Icon className="size-8 text-line" />
                    <p className="text-sm text-faint">{EMPTY[kind]}</p>
                    {kind === "inbox" ? <p className="flex items-center gap-1.5 text-xs text-faint any-pointer-coarse:hidden">Press <Kbd>Q</Kbd> to add one</p> : null}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </ReducedMotionConfig>
        )}
      </div>
      </ScrollFade>
      <DeleteTask task={doomed} onClose={() => setDeleting(null)} onGone={() => { if (open === deleting && !embedded) openTask(null); }} />
    </section>
  );
}
