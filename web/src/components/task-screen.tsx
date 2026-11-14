// A task list's screen (routes/_app/inbox.tsx and the others): the list, and from `md` the open task beside it (`?t=<id>`). On a
// phone-width window, and while a note lies over the list, the task is a drawer over the screen instead (task-drawer.tsx).
import { ListTodo, Menu } from "lucide-react";
import { TaskList } from "@/components/task-list";
import { OpenTask } from "@/components/task-detail";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { startOf, useShell } from "@/hooks/shell";
import { useNarrow } from "@/hooks/media";
import { isTaskView, taskInDrawer, useNav, usePlace } from "@/lib/nav";

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
  const { closeTask } = useNav(), { openMenu } = useShell();
  if (!task) return <Nothing />;
  // From `md` to `lg` the views menu has no rail to live in
  return <OpenTask id={task} onGone={closeTask} leading={<Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Views" onClick={openMenu}><Menu /></Button>} />;
}

/** The task lists' route component: which list, and which task, are the router's. */
export function TaskScreen() {
  const { add } = useShell(), place = usePlace(), narrow = useNarrow();
  const { view } = place;
  if (!isTaskView(view)) return null;
  const { kind } = view;
  return (
    <>
      <div className="w-full shrink-0 border-r border-line md:w-[360px] xl:w-[420px]">
        <TaskList key={kind} view={{ kind }} onAdd={() => add(startOf(kind))} />
      </div>
      {narrow ? null : <main className="min-w-0 flex-1"><Pane task={taskInDrawer(place, narrow) ? undefined : place.task} /></main>}
    </>
  );
}
