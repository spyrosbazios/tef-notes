// A task list's screen (routes/_app/inbox.tsx and the others): the list, and the task open beside it (`?t=<id>`). On a phone-width
// window they take turns: an open task is the whole screen, with a Back.
import { ListTodo } from "lucide-react";
import { TaskList } from "@/components/task-list";
import { DetailLeading, TaskDetail } from "@/components/task-detail";
import { Kbd } from "@/components/ui/kbd";
import { startOf, useShell } from "@/hooks/shell";
import { useTasks } from "@/hooks/todo";
import { isTaskView, useNav, usePlace } from "@/lib/nav";
import { cn } from "@/lib/utils";

function Nothing() {
  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div className="space-y-4">
        <ListTodo className="mx-auto size-10 text-line" />
        <p className="text-sm text-dim">Pick a task, or add one.</p>
        <div className="flex justify-center gap-4 text-xs text-faint any-pointer-coarse:hidden">
          <span className="inline-flex items-center gap-1.5"><Kbd>Q</Kbd> task</span>
          <span className="inline-flex items-center gap-1.5"><Kbd>N</Kbd> new note</span>
          <span className="inline-flex items-center gap-1.5"><Kbd>⌘K</Kbd> search</span>
        </div>
      </div>
    </div>
  );
}

function Pane({ task }: { task: string | undefined }) {
  const { openTask } = useNav(), { openMenu } = useShell();
  const tasks = useTasks();
  if (!task) return <Nothing />;
  const t = tasks.data?.find((x) => x.id === task);
  if (!t) return tasks.isPending ? null : <div className="grid h-full place-items-center text-sm text-faint">This task is gone: deleted on another device.</div>;
  return <TaskDetail key={t.id} task={t} leading={<DetailLeading onBack={() => openTask(null)} onMenu={openMenu} />} onGone={() => openTask(null)} />;
}

/** The task lists' route component: which list, and which task, are the router's. */
export function TaskScreen() {
  const { add } = useShell(), { view, task } = usePlace();
  if (!isTaskView(view)) return null;
  const { kind } = view;
  const focus = !!task;
  return (
    <>
      <div className={cn("w-full shrink-0 border-r border-line md:w-[360px] xl:w-[420px]", focus && "max-md:hidden")}>
        <TaskList key={kind} view={{ kind }} onAdd={() => add(startOf(kind))} />
      </div>
      <main className={cn("min-w-0 flex-1", !focus && "max-md:hidden")}><Pane task={task} /></main>
    </>
  );
}
