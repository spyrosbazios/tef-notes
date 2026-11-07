// The notes as TanStack Query state. One query holds every note (the notebook is small, see services/notes.ts);
// writes put the server's reply straight into it, and the realtime feed puts in what another device wrote (a refetch
// only after a gap: a reconnect, or the window coming back into focus).
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { isNotePath, newNotePath, noteKindOf, serializeNote, withFlags, type Color, type Flags } from "@/core/notes";
import { inheritTags, inLens } from "@/core/lens";
import { Conflict } from "@/core/pocketbase";
import { localDay } from "@/core/time";
import * as notes from "@/services/notes";
import { watch, type NoteChange } from "@/services/realtime";
import type { NoteRec, Rec } from "@/services/notes";
import { CHATS } from "./agent";
import { useActiveLens, activeLensOf } from "./lens";
import { applyLink, forgetEnd, LINKS } from "./links";
import { PHOTOS } from "./photos";
import { applyTask, TASKS } from "./todo";

export const NOTES = ["notes"] as const;

export const useNotes = () => useQuery({ queryKey: NOTES, queryFn: notes.all, refetchOnWindowFocus: true });

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

/** A record as the server now has it, in place of the cached one (or gone, when null). */
export function store(qc: QueryClient, r: Rec | null, path?: string) {
  qc.setQueryData<NoteRec[]>(NOTES, (all = []) => {
    const rest = all.filter((n) => n.path !== (r?.path ?? path));
    return r ? [notes.withNote(r), ...rest] : rest;
  });
}


/** The cache after a write: the server's reply goes in over any refetch still out, which started before the write and
 *  would bring the note back as it was — that one is cancelled, and run again once the reply is in. */
export async function commit(qc: QueryClient, r: Rec | null, path?: string) {
  const out = qc.isFetching({ queryKey: NOTES }) > 0;
  await qc.cancelQueries({ queryKey: NOTES });
  store(qc, r, path);
  if (out) void qc.invalidateQueries({ queryKey: NOTES });
}

/** A change another device made, into the cache as it came. Ours (the rev is stored already) and one older than the
 *  cache's copy are left out. */
function apply(qc: QueryClient, { action, record: r }: NoteChange): boolean {
  const all = qc.getQueryData<NoteRec[]>(NOTES);
  if (!all || !isNotePath(r.path)) return true;                  // not loaded yet: its first fetch has it all
  if (action === "delete") { store(qc, null, r.path); return true; }
  if (typeof r.text !== "string") return false;
  const mine = all.find((n) => n.path === r.path);
  if (mine && mine.rev >= r.rev) return true;
  store(qc, { rec: r.id, path: r.path, rev: r.rev, kind: noteKindOf(r.kind), text: r.text, updated: r.updated });
  return true;
}

/** Edits from the phone, the CLI or the agent, live; the tasks and links the same
 *  (a note or task gone takes its links with it: the server's cascade); a new photo refreshes the photo lists, a chat the chat list. */
export function useLive() {
  const qc = useQueryClient();
  useEffect(() => {
    let notes: ReturnType<typeof setTimeout> | undefined, photos: ReturnType<typeof setTimeout> | undefined, chats: ReturnType<typeof setTimeout> | undefined, todo: ReturnType<typeof setTimeout> | undefined, links: ReturnType<typeof setTimeout> | undefined;
    const refetch = () => { clearTimeout(notes); notes = setTimeout(() => qc.invalidateQueries({ queryKey: NOTES }), 250); };
    const refetchTodo = () => { clearTimeout(todo); todo = setTimeout(() => qc.invalidateQueries({ queryKey: TASKS }), 250); };
    const refetchLinks = () => { clearTimeout(links); links = setTimeout(() => qc.invalidateQueries({ queryKey: LINKS }), 250); };
    const relist = () => { clearTimeout(chats); chats = setTimeout(() => qc.invalidateQueries({ queryKey: CHATS }), 250); };
    const stop = watch({
      onNote: (c) => { if (c.action === "delete") forgetEnd(qc, { type: "note", id: c.record.id }); if (!apply(qc, c)) refetch(); },
      onPhoto: () => { clearTimeout(photos); photos = setTimeout(() => qc.invalidateQueries({ queryKey: PHOTOS }), 250); },
      onTask: (c) => { if (c.action === "delete") forgetEnd(qc, { type: "task", id: c.record.id }); applyTask(qc, c); },
      onLink: (c) => applyLink(qc, c.action, c.record),
      onChat: relist,
      onReconnect: () => { refetch(); refetchTodo(); refetchLinks(); relist(); },
    });
    return () => { clearTimeout(notes); clearTimeout(photos); clearTimeout(chats); clearTimeout(todo); clearTimeout(links); stop(); };
  }, [qc]);
}

/** The note was deleted elsewhere while it was being changed here. */
export class Gone extends Error {}

/** `edit` applied to the note's text and written at its rev. When the note moved on meanwhile, `edit` is applied
 *  again to the text as it is now — redoing the change, never resending the old result over the newer one. `edit`
 *  throws to stop (a draft whose lines clash with the newer text). */
export async function write(qc: QueryClient, r: Rec, edit: (text: string) => string): Promise<Rec> {
  let cur: Rec = r;
  for (let i = 0; ; i++) {
    try {
      const out = await notes.update(cur, edit(cur.text));
      if (!out) throw new Gone("This note was deleted on another device.");
      await commit(qc, out);
      return out;
    } catch (e) {
      if (!(e instanceof Conflict) || i === 3) throw e;
      const now = await notes.get(cur.rec);
      if (!now) { await commit(qc, null, cur.path); throw new Gone("This note was deleted on another device."); }
      await commit(qc, now);
      cur = now;
    }
  }
}

export type FlagEdit = Partial<Omit<Flags, "color">> & { color?: Color | null };

export const setFlags = (qc: QueryClient, r: Rec, flags: FlagEdit) => write(qc, r, (text) => withFlags(r.path, text, flags));

/** A new note, its path made from the title; `-2`, `-3` when the laptop or the phone took it first. Under a lens it carries the
 *  lens's first tag. */
export async function createNote(qc: QueryClient, title: string, body = ""): Promise<Rec> {
  const taken = new Set((qc.getQueryData<NoteRec[]>(NOTES) ?? []).map((n) => n.path));
  for (;;) {
    const path = newNotePath(title, Date.now(), taken);
    try {
      const r = await notes.create(path, serializeNote({ title: title.trim(), created: localDay(), tags: inheritTags(activeLensOf(qc)) }, body));
      await commit(qc, r);
      return r;
    } catch (e) {
      if (!(e instanceof Conflict)) throw e;
      taken.add(path);
    }
  }
}

/** Deleted, if nobody changed it since. Conflict: they did, and the list now shows their version. */
export async function deleteNote(qc: QueryClient, r: Rec): Promise<void> {
  try {
    await notes.remove(r);
    await commit(qc, null, r.path);
  } catch (e) {
    if (e instanceof Conflict) await commit(qc, await notes.get(r.rec), r.path);
    throw e;
  }
}
