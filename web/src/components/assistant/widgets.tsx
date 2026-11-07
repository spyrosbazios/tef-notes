// What the assistant's show_* tools return, drawn (the contract is `@/core/widgets`: typed data, a fixed component per `type`).
// Display only: a widget writes nothing, a tick on a task row is the card's own, and saving a lens is the owner's button.
// Task and note rows are the chat's cards (cards.tsx), drawn live from the app's own records.
import { CalendarDays, Check, Clock, ExternalLink, FileText, Focus, Plus, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { TagBadge } from "@/components/tag-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDays, dayLabel, dayParts } from "@/core/dates";
import { lensProblem, LENS_NAME_MAX } from "@/core/lens";
import { fold, noteIdOf } from "@/core/notes";
import { Conflict, previewPictureUrl } from "@/core/pocketbase";
import { ACCENTS, accentColor, THEMES } from "@/core/theme";
import type { DayWidget, LensWidget, LinkWidget, QuoteWidget, ReviewWidget, WeekWidget, Widget } from "@/core/widgets";
import { useAppearance } from "@/hooks/appearance";
import { setActiveLens, useCreateLens, useLenses } from "@/hooks/lens";
import { useNotes } from "@/hooks/notes";
import { useToday } from "@/hooks/todo";
import { useNav, type TaskView } from "@/lib/nav";
import { message } from "@/services/api";
import { cn } from "@/lib/utils";
import { Cards, LiveTask, Shell } from "./cards";

const when = (day: string, o: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00`).toLocaleDateString("en-US", o);

function Heading({ icon, title, detail }: { icon: ReactNode; title: string; detail?: string }) {
  return (
    <h3 className="flex items-baseline gap-2 text-[15px] font-semibold leading-snug">
      <span className="self-center text-dim">{icon}</span>
      <span>{title}</span>
      {detail ? <span className="text-sm font-normal text-dim">{detail}</span> : null}
    </h3>
  );
}

const Note = ({ children }: { children: ReactNode }) => <p className="text-xs text-faint">{children}</p>;

// ---- day

function DayView({ w }: { w: DayWidget }) {
  const today = useToday();
  const { label, detail } = dayParts(w.date, today);
  const foot = [w.more ? `+${w.more} more` : "", w.done ? `${w.done} done` : ""].filter(Boolean).join(" · ");
  return (
    <section aria-label={`${label}'s plan`} className="space-y-2.5">
      <Heading icon={<CalendarDays className="size-4" />} title={label} detail={detail} />
      {w.booked.length ? (
        <ol className="space-y-2">
          {w.booked.map((b) => (
            <li key={b.task.id} className="flex items-start gap-2.5">
              <div className="w-11 shrink-0 pt-2.5 text-right text-xs tabular-nums leading-tight text-dim">
                <span className="block font-semibold text-fg">{b.at}</span>
                <span className="block text-faint">{b.until}</span>
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className={cn("rounded-2xl", b.clash && "ring-1 ring-warn")}><LiveTask card={b.task} /></div>
                {b.clash ? <p className="flex items-center gap-1 text-xs font-medium text-warn"><TriangleAlert className="size-3.5" /> Another task holds this hour</p> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      {w.unscheduled.length ? (
        <div className="space-y-2">
          {w.booked.length ? <Note>No set time</Note> : null}
          <Cards cards={w.unscheduled} />
        </div>
      ) : null}
      {!w.booked.length && !w.unscheduled.length ? <Note>Nothing open for this day.</Note> : null}
      {foot ? <Note>{foot}</Note> : null}
    </section>
  );
}

// ---- week

/** The task list a day belongs to: what has come or is overdue is Today's, a later day Upcoming's. */
const listOf = (day: string, today: string): TaskView => (day <= today ? "today" : "upcoming");

function WeekView({ w }: { w: WeekWidget }) {
  const today = useToday(), { goView, showTask } = useNav();
  const last = w.days.at(-1)?.date ?? addDays(w.start, 6);
  return (
    <section aria-label="The week" className="space-y-2.5">
      <Heading icon={<CalendarDays className="size-4" />} title="Week" detail={`${when(w.start, { month: "short", day: "numeric" })} – ${when(last, { month: "short", day: "numeric" })}`} />
      <div className="@container">
        <div className="grid grid-cols-1 gap-1.5 @md:grid-cols-7">
          {w.days.map((d) => {
            const list = listOf(d.date, today), now = d.date === today;
            return (
              <div key={d.date} className={cn("flex min-w-0 flex-col gap-1.5 rounded-xl border bg-card p-2", now ? "border-brand" : "border-line")}>
                <button type="button" onClick={() => goView({ kind: list })} aria-label={`${dayLabel(d.date, today)}: ${d.open} open, go to ${list}`}
                  className="flex items-baseline gap-1.5 text-left @md:flex-col @md:items-start @md:gap-0">
                  <span className={cn("text-xs font-semibold uppercase", now ? "text-brand" : "text-dim")}>{when(d.date, { weekday: "short" })}</span>
                  <span className="text-base font-semibold tabular-nums leading-tight">{+d.date.slice(8)}</span>
                </button>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs tabular-nums text-dim">
                  <span>{d.open} open</span>
                  {d.booked ? <span className="inline-flex items-center gap-0.5" title={`${d.booked} booked at an hour`}><Clock className="size-3" />{d.booked}</span> : null}
                  {d.overdue ? <span className="inline-flex items-center gap-0.5 font-semibold text-warn" title={`${d.overdue} overdue`}><TriangleAlert className="size-3" />{d.overdue}</span> : null}
                </div>
                {d.top.length ? (
                  <ul className="space-y-0.5">
                    {d.top.map((t) => (
                      <li key={t.id}>
                        <button type="button" onClick={() => showTask({ kind: list }, t.id)} title={t.title}
                          className="line-clamp-2 w-full text-left text-[13px] leading-snug text-fg hover:underline">{t.title}</button>
                      </li>
                    ))}
                    {d.open > d.top.length ? <li className="text-xs text-faint">+{d.open - d.top.length} more</li> : null}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---- review

function Tile({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-xl border border-line bg-card px-3 py-2">
      <p className="text-2xl font-semibold tabular-nums leading-tight">{n}</p>
      <p className="text-xs text-dim">{label}</p>
    </div>
  );
}

function ReviewView({ w }: { w: ReviewWidget }) {
  const range = `${when(w.from, { month: "short", day: "numeric" })} – ${when(w.to, { month: "short", day: "numeric" })}`;
  return (
    <section aria-label="Review" className="space-y-2.5">
      <Heading icon={<Check className="size-4" />} title={`The last ${w.days} days`} detail={range} />
      <div className="@container">
        <div className="grid grid-cols-2 gap-1.5 @md:grid-cols-4">
          <Tile n={w.done} label="Tasks done" />
          <Tile n={w.added} label="Tasks added" />
          <Tile n={w.notesAdded} label="Notes added" />
          <Tile n={w.notesEdited} label="Notes edited" />
        </div>
      </div>
      {w.stalled.length ? (
        <div className="space-y-2">
          <Note>Stalled: open and untouched for two weeks or more</Note>
          {w.stalled.map((s) => (
            <div key={s.task.id} className="flex items-center gap-2">
              <div className="min-w-0 flex-1"><LiveTask card={s.task} /></div>
              <span className="w-14 shrink-0 text-xs tabular-nums text-warn">idle {s.idle} d</span>
            </div>
          ))}
          {w.stalledTotal > w.stalled.length ? <Note>{w.stalledTotal} stalled in all</Note> : null}
        </div>
      ) : null}
      {w.tags.length ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {w.tags.map((t) => (
            <span key={t.tag} className="inline-flex items-center gap-1"><TagBadge name={t.tag} /><span className="text-xs tabular-nums text-faint">{t.count}</span></span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

// ---- quote

function QuoteView({ w }: { w: QuoteWidget }) {
  const { openNote } = useNav(), { data, isPending } = useNotes();
  const gone = !isPending && !data?.some((n) => n.path === w.path);
  return (
    <Shell onOpen={() => openNote(noteIdOf(w.path))} gone={gone} label={w.title || w.path}>
      <div className="space-y-2 p-3">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-dim"><FileText className="size-3.5 shrink-0" /><span className="min-w-0 truncate">{w.title || "Untitled"}</span></p>
        <blockquote className="whitespace-pre-wrap break-words border-l-2 border-brand pl-3 text-sm leading-relaxed">
          {w.before ? <span className="text-dim">{w.before} </span> : null}
          <span className="font-medium text-fg">{w.quote}</span>
          {w.after ? <span className="text-dim"> {w.after}</span> : null}
        </blockquote>
      </div>
    </Shell>
  );
}

// ---- link

function LinkView({ w }: { w: LinkWidget }) {
  const p = w.preview, [broken, setBroken] = useState(false);
  const src = previewPictureUrl({ url: location.origin }, p, "sharp") ?? (/^https?:\/\//i.test(p.image) ? p.image : "");
  let host = p.url;
  try { host = new URL(p.url).hostname.replace(/^www\./, ""); } catch { /* shown as given */ }
  return (
    <a href={p.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${p.title || host}`}
      className="block overflow-hidden rounded-2xl border border-line bg-card transition-colors hover:bg-raised focus-visible:border-brand focus-visible:outline-none">
      {src && !broken ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" draggable={false} onError={() => setBroken(true)} className="h-32 w-full object-cover" /> : null}
      <div className="space-y-1 p-3">
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug">{p.title || p.site || host}</h3>
        {p.description ? <p className="line-clamp-2 text-[13px] text-dim">{p.description}</p> : null}
        <p className="flex items-center gap-1 text-xs text-faint"><ExternalLink className="size-3 shrink-0" /><span className="min-w-0 truncate">{p.site || host}</span></p>
      </div>
    </a>
  );
}

// ---- lens

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.map(fold).sort().join("\n") === b.map(fold).sort().join("\n");

function LensView({ w }: { w: LensWidget }) {
  const create = useCreateLens(), { data: all = [] } = useLenses(), { theme } = useAppearance();
  const [typed, setTyped] = useState("");
  const name = (w.name ?? typed).trim(), problem = lensProblem({ name, tags: w.tags, exclude: w.exclude });
  const found = all.find((l) => fold(l.name) === fold(name));
  const saved = !!found && same(found.tags, w.tags) && same(found.exclude, w.exclude) && (found.accent ?? null) === (w.accent ?? null);
  const taken = !!found && !saved;
  const save = async () => {
    if (problem || taken || saved) return;
    try { setActiveLens((await create.mutateAsync({ name, tags: w.tags, exclude: w.exclude, accent: w.accent ?? null })).rec); }
    catch (e) { toast.error(e instanceof Conflict ? "A lens by that name exists." : message(e)); }
  };
  return (
    <section aria-label="Lens preview" className="space-y-2.5 rounded-2xl border border-line bg-card p-3">
      <div className="flex items-center gap-2">
        <Focus className="size-4 shrink-0 text-dim" />
        {w.name ? <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{w.name}</h3>
          : <Input value={typed} maxLength={LENS_NAME_MAX} onChange={(e) => setTyped(e.target.value)} placeholder="Name this lens" aria-label="Lens name" className="flex-1" />}
        {w.accent ? <span role="img" aria-label={ACCENTS[w.accent].label} title={ACCENTS[w.accent].label} className="size-4 shrink-0 rounded-full" style={{ backgroundColor: accentColor(THEMES[theme], w.accent) }} /> : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {w.tags.map((t) => <TagBadge key={t} name={t} />)}
        {w.exclude.length ? <span className="text-xs text-faint">hides</span> : null}
        {w.exclude.map((t) => <TagBadge key={t} name={t} className="opacity-70" />)}
      </div>
      <p className="text-sm text-dim tabular-nums">{w.notes.count} {w.notes.count === 1 ? "note" : "notes"} · {w.tasks.count} {w.tasks.count === 1 ? "task" : "tasks"}</p>
      {w.notes.sample.length || w.tasks.sample.length ? <Cards cards={[...w.notes.sample, ...w.tasks.sample]} /> : null}
      <div className="flex items-center justify-between gap-2">
        <p className={cn("min-w-0 text-xs", taken || (problem && name) ? "text-down" : "text-faint")}>
          {taken ? "A lens by that name exists." : problem && name ? problem : saved ? "In your lenses." : ""}
        </p>
        <Button size="sm" className="shrink-0 rounded-full" disabled={!!problem || taken || saved || create.isPending} onClick={() => { void save(); }}>
          {saved ? <><Check /> Saved</> : <><Plus /> {create.isPending ? "Saving…" : "Save lens"}</>}
        </Button>
      </div>
    </section>
  );
}

/** The widget a `show_*` call returned, as its fixed component. */
export function WidgetView({ widget }: { widget: Widget }) {
  switch (widget.type) {
    case "day": return <DayView w={widget} />;
    case "week": return <WeekView w={widget} />;
    case "review": return <ReviewView w={widget} />;
    case "quote": return <QuoteView w={widget} />;
    case "link": return <LinkView w={widget} />;
    case "lens": return <LensView w={widget} />;
  }
}
