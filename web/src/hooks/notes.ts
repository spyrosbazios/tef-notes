// The notes as TanStack Query state, over the local copy (lib/local.ts). One query holds every note (the notebook is small); it is
// read from the copy, never from the server: every write goes to the copy first and shows at once, and the sync (lib/sync.ts,
// packages/core/src/sync.ts) sends it, offline or not, and brings other devices' edits in. `rev` is the server's as of the last
// sync (0 for a note made here until it first goes up); `rec` is the note's record id, made here for a note made here, so it
// can be linked to at once (the link goes up after the note).
import { queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { newNotePath, serializeNote, withFlags, type FlagEdit } from "@/core/notes";
import { inheritTags, inLens } from "@/core/lens";
import { recordId } from "@/core/pocketbase";
import { addNote, removeNote, writeNote } from "@/core/sync";
import { localDay } from "@/core/time";
import { local } from "@/lib/local";
import { localEdited, noteOf, NOTES, projectLocal, readNotes } from "@/lib/local-records";
import { getNet, isOffline } from "@/lib/net";
import { LOCAL_QUERY, movedTo, opened, settle, syncNow, syncing, type Settle } from "@/lib/sync";
import * as notes from "@/services/notes";
import type { NoteRec, Rec } from "@/services/notes";
import { useActiveLens, activeLensOf } from "./lens";

export { NOTES } from "@/lib/local-records";

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

// ---- writes

/** The note was deleted elsewhere while it was being changed here. */
export class Gone extends Error {}

/** `edit` applied to the note's text as the copy has it now (the sync may have merged another device's edit in since the caller
 *  last looked) and written there, to go up on the next sync. `edit` throws to stop (a draft whose lines clash with the newer text). */
export async function write(qc: QueryClient, r: Rec, edit: (text: string) => string): Promise<Rec> {
  const path = movedTo(r.path), row = local.notes.get(path);
  if (!row || row.deleted) throw new Gone("This note was deleted on another device.");
  if (writeNote(local, path, edit(row.text))) { localEdited(qc, "notes"); }
  return noteOf(local.notes.get(path)!);
}

export const setFlags = (qc: QueryClient, r: Rec, flags: FlagEdit) => write(qc, r, (text) => withFlags(r.path, text, flags));

/** Whether the server has a note at `path` already; false when it can't be asked (offline, slow): the sync moves a clash aside. */
async function onServer(path: string): Promise<boolean> {
  if (isOffline(getNet())) return false;
  try { return !!(await notes.read(path, 3000)); } catch { return false; }
}

/** A new note, its path made from the title; `-2`, `-3` when this copy or, while the server answers, the server has the name.
 *  Under a lens it carries the lens's first tag. */
export async function createNote(qc: QueryClient, title: string, body = ""): Promise<Rec> {
  const taken = new Set(local.notes.all().map((n) => n.path));
  for (;;) {
    const path = newNotePath(title, Date.now(), taken);
    if (await onServer(path)) { taken.add(path); continue; }
    addNote(local, recordId(), path, serializeNote({ title: title.trim(), created: localDay(), tags: inheritTags(activeLensOf(qc)) }, body));
    localEdited(qc, "notes");
    return noteOf(local.notes.get(path)!);
  }
}

/** Where the note at `path` is on the server, sent there first when it has never been: what anything filed under a note's id
 *  (its photos, PDFs and drawings) waits for. A note made here may still move aside to `-2` on its first push (another device
 *  had the name); once on the server its path never changes, so a file put under it there stays with it. Throws when it
 *  couldn't go up (offline, refused). */
export async function landed(path: string): Promise<string> {
  const row = local.notes.get(movedTo(path));
  if (row && !row.deleted && row.rev != null) return row.path;
  await syncNow();
  const now = local.notes.get(movedTo(path));
  if (!now || now.deleted) throw new Gone("This note was deleted.");
  if (now.rev == null) throw new Error(now.refused ? `The server refused this note: ${now.refused}` : "This note isn't on the server yet, so files can't be added to it. Try again when it's reachable.");
  return now.path;
}

/** Gone from the lists now, from the server on the next sync, if nobody changed it since (else it comes back with their edit). */
export async function deleteNote(qc: QueryClient, r: Rec): Promise<void> {
  if (removeNote(local, movedTo(r.path), syncing())) { localEdited(qc, "notes"); }
}

/** A note in conflict settled (Settings > Server & sync). */
export function settleNote(qc: QueryClient, path: string, how: Settle): void {
  if (settle(path, how)) projectLocal(qc, "notes");
}
