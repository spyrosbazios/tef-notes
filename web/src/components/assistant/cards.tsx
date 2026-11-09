// The records the agent shows or leaves behind, as cards under its step: a note, a task. A card is drawn
// from the web app's own copy of the record when it has one (so a tick or an edit shows at once), else from the
// snapshot the tool returned; one whose record is gone is dimmed and opens nothing.
import { useQueryClient } from "@tanstack/react-query";
import { Bell, Calendar, Flag, ListChecks, MapPin, Moon, Repeat } from "lucide-react";
import { useMemo, type KeyboardEvent, type ReactNode } from "react";
import { Markdown } from "@/components/markdown";
import { TagBadge } from "@/components/tag-badge";
import { TickBox } from "@/components/tick-box";
import { cardKey, noteCardOf, taskCardOf, type Card, type NoteCard, type TaskCard } from "@/core/agent";
import { dayLabel, everyLabel, whenLabel } from "@/core/dates";
import { noteIdOf } from "@/core/notes";
import { photoMarkdown } from "@/core/photos";
import { useNotes } from "@/hooks/notes";
import { toggleTask, useLingering } from "@/hooks/linger";
import { useNotePictures } from "@/hooks/thumbs";
import { Mosaic } from "../note-pictures";
import { useTasks, useToday } from "@/hooks/todo";
import { homeOfTask, useNav } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { Rise } from "./rise";

/** A card's surface: a button to the record, or a plain dimmed one when the record is gone. */
export function Shell({ onOpen, gone, label, children }: { onOpen: () => void; gone: boolean; label: string; children: ReactNode }) {
  const key = (e: KeyboardEvent) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(); } };
  const look = "block w-full overflow-hidden rounded-2xl border border-line bg-card text-left";
  if (gone) return <div className={cn(look, "opacity-60")} title="Deleted">{children}</div>;
  return (
    <div role="button" tabIndex={0} aria-label={`Open ${label}`} onClick={onOpen} onKeyDown={key}
      className={cn(look, "cursor-pointer transition-colors hover:bg-raised focus-visible:border-brand focus-visible:outline-none")}>
      {children}
    </div>
  );
}

const Chip = ({ children, className }: { children: ReactNode; className?: string }) =>
  <span className={cn("inline-flex items-center gap-1 text-xs text-faint", className)}>{children}</span>;

// ---- note

function NoteView({ card, gone }: { card: NoteCard; gone: boolean }) {
  const { openNote } = useNav();
  const id = noteIdOf(card.path);
  const [ref, pictures] = useNotePictures<HTMLDivElement>(id, card.image ? photoMarkdown(id, [card.image]) : "");
  const long = card.preview.length > 240 || card.preview.split("\n").length > 5;
  return (
    <Shell onOpen={() => openNote(id)} gone={gone} label={card.title}>
      <div ref={ref}>
        <Mosaic sources={pictures} className="h-32" />
        <div className="flex flex-col gap-1.5 p-3">
          <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug">{card.title}</h3>
          {card.preview ? (
            <div className="relative max-h-36 overflow-hidden">
              <Markdown body={card.preview} className="text-[13px] text-dim [&_a]:pointer-events-none [&_input]:pointer-events-none" />
              {long ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-b from-transparent to-card" /> : null}
            </div>
          ) : null}
          {card.where ? <span className="flex min-w-0 items-center gap-1 text-xs text-dim"><MapPin className="size-3 shrink-0" /><span className="truncate">{card.where}</span></span> : null}
          {card.tags?.length ? <span className="flex flex-wrap gap-1">{card.tags.map((t) => <TagBadge key={t} name={t} />)}</span> : null}
        </div>
      </div>
    </Shell>
  );
}

export function LiveNote({ card }: { card: NoteCard }) {
  const { data, isPending } = useNotes();
  const local = data?.find((n) => n.path === card.path);
  const live = useMemo(() => (local ? noteCardOf(local.path, local.text) : card), [local, card]);
  return <NoteView card={live} gone={!local && !isPending} />;
}

// ---- task

function TaskView({ card, today, onTick, gone }: { card: TaskCard; today: string; onTick?: () => void; gone: boolean }) {
  const { showTask } = useNav();
  const lingering = useLingering();
  const checked = lingering.has(card.id) ? lingering.get(card.id)!.checked : !!card.done;
  const when = whenLabel(card, today);
  const overdue = !!card.due && card.due < today;
  return (
    <Shell onOpen={() => showTask(homeOfTask(card), card.id)} gone={gone} label={card.title}>
      <div className="flex items-start gap-3 px-3 py-2.5">
        <TickBox checked={checked} disabled={!onTick} aria-label={checked ? `Mark "${card.title}" not done` : `Mark "${card.title}" done`}
          onClick={(e) => { e.stopPropagation(); onTick?.(); }} onKeyDown={(e) => e.stopPropagation()} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className={cn("text-[15px] leading-snug", checked ? "text-faint line-through decoration-faint" : "text-fg")}>{card.title}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            {card.checklist ? <Chip className="tabular-nums"><ListChecks className="size-3" />{card.checklist[0]}/{card.checklist[1]}</Chip> : null}
            {when ? <Chip>{card.evening ? <Moon className="size-3" /> : <Calendar className="size-3" />}{when}</Chip> : null}
            {card.every ? <Chip><Repeat className="size-3" />{everyLabel(card.every)}</Chip> : null}
            {card.remind ? <Chip><Bell className="size-3" />{card.remind}</Chip> : null}
            {card.where ? <Chip><MapPin className="size-3" />{card.where}</Chip> : null}
            {card.tags?.map((t) => <TagBadge key={t} name={t} />)}
            {card.done && checked ? <Chip>Done {dayLabel(card.done, today)}</Chip> : null}
          </div>
        </div>
        {card.due ? (
          <span className={cn("mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs text-warn", overdue && "font-semibold")}>
            <Flag className="size-3" />{dayLabel(card.due, today)}
          </span>
        ) : null}
      </div>
    </Shell>
  );
}

export function LiveTask({ card }: { card: TaskCard }) {
  const qc = useQueryClient(), today = useToday();
  const tasks = useTasks();
  const local = tasks.data?.find((t) => t.id === card.id);
  const live = useMemo(() => (local ? taskCardOf(local) : card), [local, card]);
  return <TaskView card={live} today={today} gone={!local && !tasks.isPending} onTick={local ? () => { void toggleTask(qc, local); } : undefined} />;
}

/** The cards one after another; each is drawn live where the app has the record. `live`: the reply is coming, so a card that appears
 *  rises in (the list's entrance, `Rise`); cards that are there when a chat opens sit still. */
export function Cards({ cards, live = false }: { cards: Card[]; live?: boolean }) {
  return (
    <div className="space-y-2">
      {cards.map((c) => (
        <Rise key={cardKey(c)} live={live}>{c.kind === "note" ? <LiveNote card={c} /> : <LiveTask card={c} />}</Rise>
      ))}
    </div>
  );
}
