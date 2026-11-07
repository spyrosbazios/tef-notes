// What the tag picker (tag-dialog.tsx) and the tags chip (tags-chip.tsx) work on: a `TagTarget`, the tag lists of one
// or many records, and a writer. Notes and tasks each supply their own writer,
// an ordinary rev-checked edit; the picker knows neither.
import { fold } from "@/core/notes";
import { allTagNames, applyTags } from "@/core/tags";
import { dedupeTags, retagTask } from "@/core/todo";
import { movedTo, noteText, useNotes } from "@/store/notes";
import { useTags } from "@/store/tags";
import { useTodo } from "@/store/todo";

export type TagTarget = {
  /** The picker's title. */
  title: string;
  /** The tags of each record it works on. */
  lists: string[][];
  /** Tags put on every record and `remove` taken off. */
  change: (add: string[], remove: string[]) => void;
};

/** Tags put on the notes and `remove` taken off, each an edit like any other: rev-checked when it goes up. */
function retag(paths: string[], add: string[], remove: string[]) {
  for (const p of paths) {
    const at = movedTo(p), text = noteText(at);
    if (text != null) useNotes.getState().write(at, applyTags(at, text, add, remove));
  }
}

/** The notes at `paths`. */
export function useNoteTags(paths: string[]): TagTarget {
  const notes = useNotes((s) => s.notes);
  const lists = paths.flatMap((p) => (notes[p] ? [notes[p].tags] : []));
  return {
    title: paths.length > 1 ? `Tags for ${paths.length} notes` : "Tags",
    lists,
    change: (add, remove) => retag(paths, add, remove),
  };
}

/** The tasks with these ids: a tag change is `useTodo.update`, so the sync merges it with the server's as a set. */
export function useTaskTags(ids: string[]): TagTarget {
  const tasks = useTodo((s) => s.tasks);
  const lists = ids.flatMap((id) => (tasks[id] ? [tasks[id].tags] : []));
  return {
    title: ids.length > 1 ? `Tags for ${ids.length} tasks` : "Tags",
    lists,
    change: (add, remove) => {
      for (const id of ids) {
        const t = useTodo.getState().tasks[id];
        if (t) useTodo.getState().update(id, { tags: retagTask(t, add, remove).tags });
      }
    },
  };
}

/** A plain list of tag names (a lens's, in the form being filled in) as a target: no record behind it, so `onChange` is given the
 *  list with the tags put on and taken off. */
export function listTagTarget(title: string, tags: string[], onChange: (tags: string[]) => void): TagTarget {
  return {
    title,
    lists: [tags],
    change: (add, remove) => onChange(dedupeTags([...tags.filter((t) => !remove.some((r) => fold(r) === fold(t))), ...add])),
  };
}

/** Every name one could pick: the definitions and what notes and tasks already carry. */
export function useTagNames(): string[] {
  const defs = useTags((s) => s.defs), list = useNotes((s) => s.list), tasks = useTodo((s) => s.tasks);
  return allTagNames(defs, [...list.map((n) => n.tags), ...Object.values(tasks).map((t) => t.tags)]);
}
