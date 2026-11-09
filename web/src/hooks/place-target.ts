// The record the assistant's set_place names (a note by path, a task by id), as the web app holds it: what its confirm
// card calls it, and the place it has now, which the proposed one replaces.
import type { WriteInput } from "@/core/agent";
import type { Place } from "@/core/places";
import { useNotes } from "@/hooks/notes";
import { useTasks } from "@/hooks/todo";

/** The record set_place names: its title and its place now, as the web app holds it. */
export function usePlaceTarget(i: WriteInput): { title: string; now: Place | null } {
  const notes = useNotes().data, tasks = useTasks().data;
  if (i.path) {
    const n = notes?.find((x) => x.path === i.path);
    return { title: n ? `“${n.note.title}”` : i.path, now: n?.note.where ?? null };
  }
  const t = tasks?.find((x) => x.id === i.task);
  return { title: t ? `“${t.title}”` : "a task", now: t?.where ?? null };
}
