// The notes index the chat's prompt lists (turn.ts), and the clip route's suggestions choose among the same notes, written
// the same way (server/pb_hooks/lib/clip.js, through the hooks' bundle of this file: server/pb_hooks/bundle). Pure: no
// I/O, nothing but core, so PocketBase's JS VM runs it too.
import { NOTES } from "@/core/notes";

export const RECENT = 60;                   // the prompt's index: every pinned note, then this many newest

/** The index's view of a note: what indexLine and list_notes read. */
export type Line = { path: string; title: string; tags: string[]; pinned: boolean; updated: number; archived?: boolean; color?: string };

const DAY = 86_400_000;
/** How long since a note was last edited, in whole days. */
export const ago = (updated: number, now = Date.now()) => {
  const d = Math.floor((now - updated) / DAY);
  return d <= 0 ? "today" : `${d}d ago`;
};

export const flagsOf = (n: Line) => (n.archived ? "archived" : n.pinned ? "pinned" : "");

/** One note as the prompt lists it: `path · title · [tags] · pinned · Nd ago`, empty parts left out. */
export const indexLine = (n: Line, now = Date.now()) =>
  [n.path, n.title, n.tags.length ? `[${n.tags.join(", ")}]` : "", flagsOf(n), ago(n.updated, now)].filter(Boolean).join(" · ");

export const newest = <T extends Line>(xs: T[]) => [...xs].sort((a, b) => b.updated - a.updated);

/** The notes the index lists, in its order: every pinned one, then the newest `n` of the rest; archived ones never (the
 *  owner put them away). `more`: the rest left out; `shelved`: the archived ones. */
export function listed<T extends Line>(list: T[], n = RECENT): { notes: T[]; more: number; shelved: number } {
  const all = list.filter((x) => x.path.startsWith(NOTES)), N = newest(all.filter((x) => !x.archived));
  const top = N.filter((x) => x.pinned), rest = N.filter((x) => !x.pinned);
  return { notes: [...top, ...rest.slice(0, n)], more: Math.max(0, rest.length - n), shelved: all.length - N.length };
}

/** The `<notes>` block: the listed notes, then how many more there are, and how many are archived (search_notes still
 *  finds them). */
export function noteIndex(list: Line[], now = Date.now(), n = RECENT) {
  const { notes, more, shelved } = listed(list, n);
  const lines = notes.map((x) => indexLine(x, now));
  if (more > 0) lines.push(`(${more} older note${more === 1 ? "" : "s"} not listed: search_notes or list_notes finds them)`);
  if (shelved > 0) lines.push(`(${shelved} archived note${shelved === 1 ? "" : "s"} not listed: search_notes or list_notes "archived" finds them)`);
  return lines.join("\n") || "(no notes yet)";
}
