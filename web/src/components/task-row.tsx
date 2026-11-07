// One task in a list, as Things draws it: a round box, the title, the notes it is about as a quiet second line,
// the deadline in the warn colour. The When button and a ⋮ show on hover; the title opens the task, a right-click its menu.
import { Bell, Calendar, Check, EllipsisVertical, Flag, ListChecks, Moon, NotebookText, PanelRight, Repeat, Trash2 } from "lucide-react";
import { useState } from "react";
import { dayLabel, everyLabel, whenLabel, type Schedule } from "@/core/dates";
import { TagBadge } from "@/components/tag-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { WhenPopover } from "@/components/when-picker";
import type { Task } from "@/core/todo";
import type { RowDrag } from "@/hooks/drag";
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
  const [menu, setMenu] = useState(false);
  const when = showWhen ? whenLabel(task, today) : null;
  const overdue = !!task.due && task.due < today;
  const ticked = task.checklist.filter((i) => i.done).length;
  return (
    <li data-task={task.id} {...drag?.props} onContextMenu={(e) => { e.preventDefault(); setMenu(true); }} className={cn("group relative flex items-start gap-3 rounded-xl px-3 py-2 transition-[opacity,background-color] duration-500 hover:bg-muted/60", selected && "bg-muted", leaving && checked && "opacity-35", drag?.dragging && "opacity-40")}>
      {drag?.mark ? <span aria-hidden className={cn("pointer-events-none absolute inset-x-3 h-0.5 rounded-full bg-brand", drag.mark === "before" ? "-top-px" : "-bottom-px")} /> : null}
      <button type="button" role="checkbox" aria-checked={checked} aria-label={checked ? `Mark "${task.title}" not done` : `Mark "${task.title}" done`} onClick={onTick}
        className={cn("mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors",
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
        <WhenPopover value={whenState(task)} today={today} onSchedule={onSchedule} onDue={onDue}>
          <Button variant="ghost" size="icon-sm" aria-label="When" title="When"
            className="-my-0.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100">
            <Calendar />
          </Button>
        </WhenPopover>
      ) : null}
      <DropdownMenu open={menu} onOpenChange={setMenu}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Task actions" title="More"
            className="-my-0.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100">
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
    </li>
  );
}
