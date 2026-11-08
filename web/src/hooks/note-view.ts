// How the notes list is laid out: one flat list or grouped under a header per tag, which groups are folded, and its sort (the
// owner's preferences, hooks/prefs.ts, shared by every device).
import { useCallback } from "react";
import { flipped } from "@/core/note-groups";
import type { NoteSort } from "@/core/note-sort";
import { prefsNow, setPrefs, usePrefs } from "./prefs";

const write = (patch: Partial<ReturnType<typeof prefsNow>["notes"]>) => setPrefs({ notes: { ...prefsNow().notes, ...patch } });

/** The list layout: `grouped`, the folded groups, the sort, and the ways to change them. */
export function useNoteView() {
  const { grouped, collapsed, sort } = usePrefs().notes;
  const setGrouped = useCallback((on: boolean) => write({ grouped: on }), []);
  const fold = useCallback((tag: string) => write({ collapsed: flipped(prefsNow().notes.collapsed, tag) }), []);
  const setSort = useCallback((next: NoteSort) => write({ sort: next }), []);
  return { grouped, collapsed, sort, setGrouped, fold, setSort };
}
