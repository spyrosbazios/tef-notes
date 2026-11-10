// A note's backlinks that are tasks (core/record-links.ts backlinks): "Linked tasks" under a note's title, a
// grouped list, each row opening the task beside the list it sits in. Nothing at all when no task links to the note.
import { ChevronRight, Circle, CircleCheck, ListTodo } from "lucide-react";
import { useMemo } from "react";
import { useLinks } from "@/hooks/links";
import { useTasks, useToday } from "@/hooks/todo";
import { taskView, tasksFor } from "@/lib/links";
import { useNav } from "@/lib/nav";
import { cn } from "@/lib/utils";
import type { NoteRec } from "@/services/notes";

export function LinkedTasks({ n, className }: { n: NoteRec; className?: string }) {
  const links = useLinks().data, tasks = useTasks().data, today = useToday(), { showTask } = useNav();
  const linked = useMemo(() => tasksFor(links ?? [], n.rec, tasks ?? []), [links, tasks, n.rec]);
  if (!linked.length) return null;
  return (
    <section aria-label="Linked tasks" className={cn("text-sm", className)}>
      <h2 className="mb-1.5 flex items-center gap-1.5 px-1 font-semibold text-[11px] text-faint uppercase tracking-wider">
        <ListTodo className="size-3.5" />Linked tasks
      </h2>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
        {linked.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => showTask(taskView(t, today), t.id)} title="Open the task"
              className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted">
              {t.done ? <CircleCheck className="size-4 shrink-0 text-dim" /> : <Circle className="size-4 shrink-0 text-brand" />}
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-fg", t.done && "text-dim line-through decoration-faint")}>{t.title}</span>
                {t.done && <span className="block text-faint text-xs">Done</span>}
              </span>
              <ChevronRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
