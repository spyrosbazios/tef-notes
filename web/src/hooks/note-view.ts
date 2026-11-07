// How the notes list is laid out in this browser: one flat list or grouped under a header per tag, which groups are
// folded, and its sort (localStorage: per browser, like the phone's `notesView` and `collapsedTags` prefs).
import { useCallback, useSyncExternalStore } from "react";
import { flipped } from "@/core/note-groups";
import { isNoteSort, type NoteSort } from "@/core/note-sort";

const KEY = "tefnotes.note-view";
type View = { grouped: boolean; collapsed: string[]; sort: NoteSort };     // collapsed: tag names, NO_TAG ("") for "No tag"
const listeners = new Set<() => void>();
let cached: { raw: string | null; view: View } | undefined;

function read(): View {
  const raw = localStorage.getItem(KEY);
  if (cached?.raw === raw) return cached.view;
  let view: View = { grouped: false, collapsed: [], sort: "updated" };
  try {
    const p = JSON.parse(raw ?? "{}");
    view = {
      grouped: p.view === "tags",
      collapsed: Array.isArray(p.collapsed) ? p.collapsed.filter((t: unknown): t is string => typeof t === "string") : [],
      sort: isNoteSort(p.sort) ? p.sort : "updated",
    };
  } catch { /* an unreadable setting is no setting */ }
  cached = { raw, view };
  return view;
}

function write(patch: Partial<View>) {
  const next = { ...read(), ...patch };
  localStorage.setItem(KEY, JSON.stringify({ view: next.grouped ? "tags" : "list", collapsed: next.collapsed, sort: next.sort }));
  listeners.forEach((l) => l());
}

/** This browser's list layout: `grouped`, the folded groups, the sort, and the ways to change them (each tells every hook using them). */
export function useNoteView() {
  const { grouped, collapsed, sort } = useSyncExternalStore((cb) => {
    listeners.add(cb);
    addEventListener("storage", cb);
    return () => { listeners.delete(cb); removeEventListener("storage", cb); };
  }, read);
  const setGrouped = useCallback((on: boolean) => write({ grouped: on }), []);
  const fold = useCallback((tag: string) => write({ collapsed: flipped(read().collapsed, tag) }), []);
  const setSort = useCallback((next: NoteSort) => write({ sort: next }), []);
  return { grouped, collapsed, sort, setGrouped, fold, setSort };
}
