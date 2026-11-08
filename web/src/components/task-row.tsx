// One task in a list, as Things draws it: a round box, the title, the notes it is about as a quiet second line,
// the deadline in the warn colour. The When button and a ⋮ show on hover (always, under a finger); the title opens the task,
// a right-click or a long press its menu. A row that can be reordered is dragged by a mouse anywhere, by a finger at its handle.
// At phone width under a finger the buttons give way to the phone's swipes (hooks/swipe.ts): right asks When (a sheet), left
// brings out Delete.
import { Bell, Calendar, Check, EllipsisVertical, Flag, GripVertical, ListChecks, Moon, NotebookText, PanelRight, Repeat, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { dayLabel, everyLabel, whenLabel, type Schedule } from "@/core/dates";
import { TagBadge } from "@/components/tag-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { WhenPick } from "@/components/when-picker";
import type { Task } from "@/core/todo";
import type { RowDrag } from "@/hooks/drag";
import { useSwipe } from "@/hooks/swipe";
import { DELETE_WIDTH, WHEN_WIDTH } from "@/lib/swipe";
import { whenState } from "@/lib/schedule";
import { cn } from "@/lib/utils";

export function TaskRowView({ task, today, checked, leaving, selected, notes, showWhen, drag, onTick, onOpen, onSchedule, onDue, onDelete }: {
  task: Task; today: string;
  /** The box as it shows: ticked rows stay in the list a moment before they go. */
  checked: boolean; leaving: boolean; selected: boolean;
  /** The notes it is about (lib/links.ts noteSummary): the first one's title and how many more; null for none. */
  notes: { title: string; more: number } | null;
  /** Whether the scheduled day is worth saying here (for an overdue one in Today; it is the heading in Upcoming). */
  showWhen: boolean;
  /** Set when the row can be dragged to another place in its list. */
  drag?: RowDrag;
  onTick: () => void; onOpen: () => void; onSchedule: (s: Schedule | null) => void; onDue: (day: string | null) => void; onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false), [picking, setPicking] = useState(false);
  const sw = useSwipe({ when: !checked, onWhen: () => setPicking(true) });
  const when = showWhen ? whenLabel(task, today) : null;
  const overdue = !!task.due && task.due < today;
  const ticked = task.checklist.filter((i) => i.done).length;
  return (
    <li data-task={task.id} {...drag?.props} {...sw.props} onPointerDown={(e) => { drag?.props.onPointerDown?.(e); sw.props.onPointerDown(e); }}
      onContextMenu={(e) => { e.preventDefault(); setMenu(true); }}
      className={cn("relative rounded-xl any-pointer-coarse:touch-pan-y transition-opacity duration-500", sw.x !== 0 && "overflow-hidden", leaving && checked && "opacity-35", drag?.dragging && "opacity-40")}>
      {sw.x > 0 ? (
        <div aria-hidden className="absolute inset-y-0 left-0 flex flex-col items-center justify-center gap-1 bg-accent text-brand" style={{ width: WHEN_WIDTH }}>
          <Star className="size-5" style={{ opacity: Math.min(1, sw.x / (0.6 * WHEN_WIDTH)), transform: `scale(${0.6 + 0.4 * Math.min(1, sw.x / WHEN_WIDTH)})` }} />
          <span className="text-[11px] font-semibold">When</span>
        </div>
      ) : null}
      {sw.x < 0 ? (
        <button type="button" data-swipe-skip aria-label="Delete" onClick={() => { sw.close(); onDelete(); }}
          className="absolute inset-y-0 right-0 flex flex-col items-center justify-center gap-1 bg-down text-bg" style={{ width: DELETE_WIDTH }}>
          <Trash2 className="size-5" />
          <span className="text-[11px] font-semibold">Delete</span>
        </button>
      ) : null}
      <div className={cn("group relative flex items-start gap-3 rounded-xl px-3 py-2 transition-[background-color] duration-500 hover:bg-muted/60", sw.x !== 0 && "bg-bg", selected && "bg-muted")}
        style={{ transform: sw.x ? `translateX(${sw.x}px)` : undefined, transition: sw.live ? "none" : undefined }}>
      {drag?.mark ? <span aria-hidden className={cn("pointer-events-none absolute inset-x-3 h-0.5 rounded-full bg-brand", drag.mark === "before" ? "-top-px" : "-bottom-px")} /> : null}
      {drag ? (
        <span data-drag-handle aria-hidden onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
          className="-mx-3 -my-2 hidden w-10 shrink-0 cursor-grab touch-none items-center justify-center self-stretch text-faint any-pointer-coarse:flex">
          <GripVertical className="size-4" />
        </span>
      ) : null}
      <button type="button" role="checkbox" aria-checked={checked} aria-label={checked ? `Mark "${task.title}" not done` : `Mark "${task.title}" done`} onClick={onTick}
        className={cn("hit relative mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors",
          checked ? "border-brand bg-brand text-bg" : "border-faint text-transparent hover:border-brand hover:text-brand/50")}>
        <Check className="size-3" strokeWidth={3.5} />
      </button>
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onOpen} title="Open the task"
          className={cn("block w-full text-left text-[15px] leading-snug transition-colors", checked ? "text-faint line-through decoration-faint" : "text-fg")}>
          {task.title}
        </button>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-faint">
          {notes ? <span className="inline-flex min-w-0 items-center gap-1"><NotebookText className="size-3 shrink-0" /><span className="truncate">{notes.title}</span>{notes.more ? <span className="shrink-0 tabular-nums">+{notes.more}</span> : null}</span> : null}
          {task.checklist.length ? <span className="inline-flex items-center gap-1 tabular-nums" title={`${ticked} of ${task.checklist.length} ticked`}><ListChecks className="size-3" />{ticked}/{task.checklist.length}</span> : null}
          {when ? <span className="inline-flex items-center gap-1">{task.evening ? <Moon className="size-3" /> : <Calendar className="size-3" />}{when}</span> : null}
          {task.every ? <span className="inline-flex items-center gap-1"><Repeat className="size-3" />{everyLabel(task.every)}</span> : null}
          {task.remind ? <span className="inline-flex items-center gap-1"><Bell className="size-3" />{task.remind}</span> : null}
          {task.tags.map((t) => <TagBadge key={t} name={t} />)}
          {task.done && checked ? <span>Done {dayLabel(task.done, today)}</span> : null}
        </div>
      </div>
      {task.due ? (
        <span className={cn("mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs text-warn", overdue && "font-semibold")}>
          <Flag className="size-3" />{dayLabel(task.due, today)}
        </span>
      ) : null}
      {!checked ? (
        <WhenPick value={whenState(task)} today={today} onSchedule={onSchedule} onDue={onDue} open={picking} onOpenChange={setPicking}>
          <Button variant="ghost" size="icon-sm" aria-label="When" title="When"
            className="-my-0.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 any-pointer-coarse:opacity-100 any-pointer-coarse:-my-2 any-pointer-coarse:max-md:hidden">
            <Calendar />
          </Button>
        </WhenPick>
      ) : null}
      <DropdownMenu open={menu} onOpenChange={setMenu}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Task actions" title="More"
            className="-my-0.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 any-pointer-coarse:opacity-100 any-pointer-coarse:-my-2 any-pointer-coarse:max-md:hidden">
            <EllipsisVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={onOpen}><PanelRight /> Open</DropdownMenuItem>
          <DropdownMenuItem onSelect={onTick}><Check /> {checked ? "Mark not done" : "Mark done"}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}><Trash2 /> Delete…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>
    </li>
  );
}
