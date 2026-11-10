// The task the assistant's set_place names, as the web app holds it: what its confirm card calls it, and the place it has
// now, which the proposed one replaces.
import type { WriteInput } from "@/core/agent";
import type { Place } from "@/core/places";
import { useTasks } from "@/hooks/todo";

/** The task set_place names: its title and its place now, as the web app holds it. */
export function usePlaceTarget(i: WriteInput): { title: string; now: Place | null } {
  const t = useTasks().data?.find((x) => x.id === i.task);
  return { title: t ? `“${t.title}”` : "a task", now: t?.where ?? null };
}
