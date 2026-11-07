// A note's linked tasks (core/record-links.ts backlinks, synced by store/todo.ts): what points at it from a task, each opening
// the task. Under a note's title. A task's own linked notes are drawn on its screen (app/task/[id].tsx).
import { Circle, CircleCheck } from "lucide-react-native";
import { useShallow } from "zustand/react/shallow";
import { backlinks } from "@/core/record-links";
import { useNoteRec } from "@/store/notes";
import { useTodo } from "@/store/todo";
import { ListRow, ListSection } from "./ds";
import { openTask } from "./tasks";
import { useTheme } from "./use-theme";

/** The tasks linking to a note (from a task, any role), each opening the task; nothing when there are none. */
export function LinkedTasks({ path, className }: { path: string; className?: string }) {
  const { C } = useTheme();
  const rec = useNoteRec(path);
  const tasks = useTodo(useShallow((s) => {
    if (!rec) return [];
    const ids = [...new Set(backlinks(s.links, rec).filter((l) => l.from.type === "task").map((l) => l.from.id))];
    return ids.flatMap((id) => (s.tasks[id] ? [s.tasks[id]] : []));
  }));
  if (!tasks.length) return null;
  return (
    <ListSection title="Linked tasks" className={className}>
      {tasks.map((t) => (
        <ListRow key={t.id} icon={t.done ? CircleCheck : Circle} iconColor={t.done ? C.dim : C.brand} title={t.title} subtitle={t.done ? "Done" : undefined}
          chevron onPress={() => openTask(t.id)} />
      ))}
    </ListSection>
  );
}
