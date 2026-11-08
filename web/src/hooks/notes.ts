// The notes as TanStack Query state, over the local copy (lib/local.ts). One query holds every note (the notebook is small); it is
// read from the copy, never from the server: every write goes to the copy first and shows at once, and the sync (lib/sync.ts,
// packages/core/src/sync.ts) sends it, offline or not, and brings other devices' edits in. `rev` and `rec` are the server's as of
// the last sync: a note made here has `rec` "" until it first goes up, and cannot be linked to before.
import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { isNotePath, newNotePath, parseNote, serializeNote, withFlags, type Color, type Flags } from "@/core/notes";
import { inheritTags, inLens } from "@/core/lens";
import { removeNote, writeNote, type NoteRow } from "@/core/sync";
import { localDay } from "@/core/time";
import { local } from "@/lib/local";
import { getNet, isOffline } from "@/lib/net";
import { edited, heard, LOCAL_QUERY, movedTo, onRedraw, opened, settle, startSync, syncing, syncNow, type Settle } from "@/lib/sync";
import * as notes from "@/services/notes";
import { watch } from "@/services/realtime";
import type { NoteRec, Rec } from "@/services/notes";
import { CHATS } from "./agent";
import { useActiveLens, activeLensOf } from "./lens";
import { projectLinks } from "./links";
import { PHOTOS } from "./photos";
import { projectTasks } from "./todo";

export const NOTES = ["notes"] as const;

// ---- the copy, as the cache has it

/** A row's note as the lists read it. Parsed once per version of the row: the list holds the whole notebook and is redrawn
 *  after every save. */
const parsed = new Map<string, { sig: string; rec: NoteRec }>();

function noteOf(row: NoteRow): NoteRec {
  const sig = `${row.updated}|${row.rev}|${row.rec}|${row.kind}`, hit = parsed.get(row.path);
  if (hit?.sig === sig) return hit.rec;
  const rec: NoteRec = {
    rec: row.rec ?? "", path: row.path, rev: row.rev ?? 0, kind: row.kind, text: row.text, updated: new Date(row.updated).toISOString(),
    note: parseNote(row.path, row.text),
  };
  parsed.set(row.path, { sig, rec });
  return rec;
}

/** Every note not deleted here, newest change first. */
function readNotes(): NoteRec[] {
  const rows = local.notes.all().filter((r) => !r.deleted && isNotePath(r.path));
  const live = new Set(rows.map((r) => r.path));
  for (const p of parsed.keys()) if (!live.has(p)) parsed.delete(p);
  return rows.map(noteOf).sort((a, b) => b.updated.localeCompare(a.updated));
}

export const projectNotes = (qc: QueryClient) => qc.setQueryData<NoteRec[]>(NOTES, readNotes());

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

// ---- the feed and the sync

/** Mounted once, in the shell: the sync's triggers (lib/sync.ts), the redraw of the lists after it changes the copy, and what
 *  the realtime feed says: a note, task or link another device changed is news for the sync (an edit made here echoing back is
 *  not), a new photo refreshes the photo lists, a chat the chat list. */
export function useLive() {
  const qc = useQueryClient();
  useEffect(() => {
    let photos: ReturnType<typeof setTimeout> | undefined, chats: ReturnType<typeof setTimeout> | undefined;
    const relist = () => { clearTimeout(chats); chats = setTimeout(() => qc.invalidateQueries({ queryKey: CHATS }), 250); };
    const redraw = onRedraw(() => { projectNotes(qc); projectTasks(qc); projectLinks(qc); });
    const stopSync = startSync();
    const stop = watch({
      onNote: (c) => heard("notes", c.action, c.record),
      onPhoto: () => { clearTimeout(photos); photos = setTimeout(() => qc.invalidateQueries({ queryKey: PHOTOS }), 250); },
      onTask: (c) => heard("tasks", c.action, c.record),
      onLink: (c) => heard("links", c.action, c.record),
      onChat: relist,
      onReconnect: () => { void syncNow(); relist(); },
    });
    return () => { clearTimeout(photos); clearTimeout(chats); stop(); stopSync(); redraw(); };
  }, [qc]);
}

// ---- writes

/** The note was deleted elsewhere while it was being changed here. */
export class Gone extends Error {}

/** `edit` applied to the note's text as the copy has it now (the sync may have merged another device's edit in since the caller
 *  last looked) and written there, to go up on the next sync. `edit` throws to stop (a draft whose lines clash with the newer text). */
export async function write(qc: QueryClient, r: Rec, edit: (text: string) => string): Promise<Rec> {
  const path = movedTo(r.path), row = local.notes.get(path);
  if (!row || row.deleted) throw new Gone("This note was deleted on another device.");
  if (writeNote(local, path, edit(row.text))) { projectNotes(qc); edited(); }
  return noteOf(local.notes.get(path)!);
}

export type FlagEdit = Partial<Omit<Flags, "color">> & { color?: Color | null };

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
    writeNote(local, path, serializeNote({ title: title.trim(), created: localDay(), tags: inheritTags(activeLensOf(qc)) }, body));
    projectNotes(qc); edited();
    return noteOf(local.notes.get(path)!);
  }
}

/** Gone from the lists now, from the server on the next sync, if nobody changed it since (else it comes back with their edit). */
export async function deleteNote(qc: QueryClient, r: Rec): Promise<void> {
  if (removeNote(local, movedTo(r.path), syncing())) { projectNotes(qc); edited(); }
}

/** A note in conflict settled (Settings > Server & sync). */
export function settleNote(qc: QueryClient, path: string, how: Settle): void {
  if (settle(path, how)) projectNotes(qc);
}
