// The list column of a task view: a Things list (Inbox, Today, Upcoming, Logbook, as core/todo.ts views
// sorts them). A task just ticked stays a moment, faded, and then leaves
// (hooks/linger.ts), at the place it had.
import { useQueryClient } from "@tanstack/react-query";
import { Moon, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
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
import { useLinks } from "@/hooks/links";
import { calm } from "@/hooks/media";
import { useNotes } from "@/hooks/notes";
import { editTask, useTasks, useViews } from "@/hooks/todo";
import { noteSummary } from "@/lib/links";
import { TASK_VIEWS, titleOf, useNav, type TaskView } from "@/lib/nav";
import { report } from "@/lib/report";
import { scheduleOf } from "@/lib/schedule";
import { cn } from "@/lib/utils";

const EMPTY: Record<TaskView, string> = {
  inbox: "Nothing waiting. New tasks land here.",
  today: "Nothing for today.",
  upcoming: "Nothing scheduled ahead.",
  logbook: "Nothing done yet.",
};

const NO_LINKS: Link[] = [];
const NO_TAGS: string[] = [];

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
  if (kind === "today" && section === "evening") return <h3 className={cn(heading, "items-center")}><Moon className="size-3.5 self-center text-brand" /><span className="text-[15px] font-extrabold">This Evening</span></h3>;
  if (kind === "upcoming") { const p = dayParts(section, today); return <h3 data-day={section} className={cn(heading, "scroll-mt-4", lit && "text-brand")}><span className="text-[15px] font-extrabold">{p.label}</span><span className="text-xs text-dim">{p.detail}</span></h3>; }
  if (kind === "logbook") return <h3 className={heading}><span className="text-[15px] font-extrabold">{section ? dayLabel(section, today) : "Earlier"}</span></h3>;
  return null;
}

/** The lists as tabs, below `md` where the rail is a drawer: Inbox and Today with their counts, as the phone's Tasks tab. */
function Tabs({ kind, inbox, today }: { kind: TaskView; inbox: number; today: number }) {
  const { goView } = useNav();
  const count = { inbox, today, upcoming: 0, logbook: 0 };
  return (
    <nav aria-label="Lists" className="flex gap-1 overflow-x-auto border-b border-line px-3 md:hidden">
      {TASK_VIEWS.map((k) => (
        <button key={k} type="button" aria-current={k === kind ? "page" : undefined} onClick={() => goView({ kind: k })}
          className={cn("-mb-px flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-sm font-semibold", k === kind ? "border-brand text-fg" : "border-transparent text-dim")}>
          {titleOf({ kind: k })}{count[k] ? <span className="text-xs font-normal tabular-nums text-faint">{count[k]}</span> : null}
        </button>
      ))}
    </nav>
  );
}

/** `embedded`: a list inside Home's task box, which draws the heading and the +: no header, no frame, scrolling inside the box's
 * fixed height, a row opening beside its own list rather than Home's. `tags`: only tasks carrying every one (Home's filter).
 * `focus`: a day Home's planner picked or is hovering: scrolled to that day (or the next one with tasks), its heading lit.
 * `onHoverDay`: the day of the row or Upcoming day under the pointer (a row's `when`, else its due), null as it leaves. */
export function TaskList({ view, onAdd, embedded = false, tags = NO_TAGS, focus = null, onHoverDay }: { view: { kind: TaskView }; onAdd?: () => void; embedded?: boolean; tags?: string[]; focus?: { day: string; n: number } | null; onHoverDay?: (day: string | null) => void }) {
  const qc = useQueryClient();
  const { views, today, isPending } = useViews();
  const notes = useNotes().data, links = useLinks().data ?? NO_LINKS;
  const { openTask, showTask, task: open } = useNav();
  const lingering = useLingering();
  const records = useTasks().data;
  const scroller = useRef<HTMLDivElement>(null);
  const more = useMoreBelow(scroller);
  const [deleting, setDeleting] = useState<string | null>(null);
  const doomed = (deleting && records?.find((r) => r.id === deleting)) || null;
  const kind = view.kind;

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
  useEffect(() => {
    if (!focus || !lit) return;
    // Only the list's own box scrolls, never the page around it
    const id = requestAnimationFrame(() => {
      const box = scroller.current, el = box?.querySelector(`[data-day="${lit}"]`);
      if (box && el) box.scrollTo({ top: box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top, behavior: calm() ? "instant" : "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [focus, lit]);

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
      <TaskRowView key={t.id} task={t} today={today} checked={checked} leaving={!!l} selected={open === t.id}
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
      <div ref={scroller} onMouseOver={onHoverDay ? (e) => hover(dayUnder(e.target)) : undefined} onMouseLeave={onHoverDay ? () => hover(null) : undefined}
        // Focus is the hover of a finger and a keyboard: a tapped or tabbed row lights its day too, until focus leaves the list
        onFocus={onHoverDay ? (e) => hover(dayUnder(e.target)) : undefined}
        onBlur={onHoverDay ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) hover(null); } : undefined}
        className={cn("min-h-0 flex-1 overflow-y-auto", embedded ? "pb-2" : "px-2 pb-24",
        more && "[mask-image:linear-gradient(to_bottom,black_calc(100%-4rem),transparent)]")}>
        {isPending ? <div className="space-y-2 px-2 pt-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10 rounded-xl" />)}</div>
          : count ? sections.map(({ key, rows }) => (
            <div key={key} data-section-day={kind === "upcoming" ? key : undefined}>
              <Heading kind={kind} section={key} today={today} lit={key === lit} />
              <ul>{rows.map((t) => row(t, key))}</ul>
            </div>
          ))
          : (
            <div className={cn("grid place-items-center gap-3 px-6 text-center", embedded ? "py-10" : "py-16")}>
              <Icon className="size-8 text-line" />
              <p className="text-sm text-faint">{EMPTY[kind]}</p>
              {kind === "inbox" ? <p className="flex items-center gap-1.5 text-xs text-faint any-pointer-coarse:hidden">Press <Kbd>Q</Kbd> to add one</p> : null}
            </div>
          )}
      </div>
      <DeleteTask task={doomed} onClose={() => setDeleting(null)} onGone={() => { if (open === deleting && !embedded) openTask(null); }} />
    </section>
  );
}

/** Whether rows sit below the scroller's fold: the last visible ones fade out while they do. */
function useMoreBelow(ref: RefObject<HTMLDivElement | null>) {
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true, subtree: true });
    return () => { el.removeEventListener("scroll", check); ro.disconnect(); mo.disconnect(); };
  }, [ref]);
  return more;
}
