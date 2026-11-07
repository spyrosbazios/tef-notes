// Every tag name one could pick: the definitions and the others notes and tasks carry. What the tag editor, the filter box and
// the palette complete from.
import { useMemo } from "react";
import { allTagNames } from "@/core/tags";
import { useNotes } from "@/hooks/notes";
import { useTags } from "@/hooks/tags";
import { useTasks } from "@/hooks/todo";

export function useTagNames(): string[] {
  const { data: defs } = useTags();
  const { data: notes } = useNotes();
  const { data: tasks } = useTasks();
  return useMemo(() => allTagNames(defs ?? [], [...(notes ?? []).map((n) => n.note.tags), ...(tasks ?? []).map((t) => t.tags)]), [defs, notes, tasks]);
}
