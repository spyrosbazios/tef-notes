// The notes as TanStack Query state, over the local copy. One query holds every note (the notebook is small); it is read from
// the copy, never from the server: every write goes to the copy first and shows at once (lib/records.ts, the one module that
// writes it), and the sync (packages/core/src/sync.ts) sends it, offline or not, and brings other devices' edits in. `rev` is
// the server's as of the last sync (0 for a note made here until it first goes up); `rec` is the note's record id, made here
// for a note made here, so it can be linked to at once (the link goes up after the note).
import { queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import { inheritTags, inLens } from "@/core/lens";
import type { NoteRow } from "@/core/sync";
import * as records from "@/lib/records";
import { LOCAL_QUERY, NOTES, onRedraw, opened, readNotes, type Settle } from "@/lib/records";
import type { NoteRec } from "@/services/notes";
import { useActiveLens, activeLensOf } from "./lens";

export { NOTES, type Settle } from "@/lib/records";
export { Gone, write, setFlags, landed, deleteNote } from "@/lib/records";

/** Every note, from the local copy once it has opened: what the routes' loaders wait for (router.ts) and the lists read. */
export const notesQuery = queryOptions({ queryKey: NOTES, queryFn: async () => { await opened(); return readNotes(); }, ...LOCAL_QUERY });

export const useNotes = () => useQuery(notesQuery);

/** The list as the phone orders it: pinned first, then newest edit. */
export function useSorted(): NoteRec[] {
  const { data } = useNotes();
  return useMemo(() => [...(data ?? [])].sort((a, b) => Number(b.note.pinned) - Number(a.note.pinned) || b.updated.localeCompare(a.updated)), [data]);
}

/** The same inside the lens that is on, as the lists show it (all of them when none is). Code that must reach a note whatever
 *  the lens says (one a task links to, one opened by its address) reads `useSorted`. */
export function useLensSorted(): NoteRec[] {
  const sorted = useSorted(), lens = useActiveLens();
  return useMemo(() => (lens ? sorted.filter((n) => inLens(lens, n.note)) : sorted), [sorted, lens]);
}

export const useNote = (id: string | undefined) => {
  const { data } = useNotes();
  return useMemo(() => (id ? data?.find((n) => n.note.id === id) : undefined), [data, id]);
};

/** The note opened as `id`, wherever it is now: a note made here that moved aside to `-2` on its first push (another device had
 *  the name) is found under its new id, which the caller puts in the address. */
export function useNoteAt(id: string): NoteRec | undefined {
  const { data } = useNotes();
  return useMemo(() => {
    const at = records.noteIdNow(id);
    return data?.find((n) => n.note.id === id) ?? (at !== id ? data?.find((n) => n.note.id === at) : undefined);
  }, [data, id]);
}

/** A note's row as the copy holds it, kept current: what Settings shows of a conflict. */
export const useNoteRow = (path: string): NoteRow | undefined =>
  useSyncExternalStore((l) => onRedraw(() => l()), () => records.noteRow(path));

// ---- writes (lib/records.ts)

/** A new note; under a lens it carries the lens's first tag. */
export const createNote = (qc: QueryClient, title: string, body = "") => records.createNote(title, body, inheritTags(activeLensOf(qc)));

/** A note in conflict settled (Settings > Server & sync). */
export const settleNote = (path: string, how: Settle): void => { records.settle(path, how); };
