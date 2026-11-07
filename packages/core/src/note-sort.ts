// Home's note orders, the web's and the phone's: by last edit or by creation, newest or oldest first, pinned notes on top in
// every one. The list a client holds is already pinned first, newest edit first, so that sort hands it back as it is.

export const NOTE_SORTS = ["updated", "updated-asc", "created", "created-asc"] as const;
export type NoteSort = (typeof NOTE_SORTS)[number];

export const NOTE_SORT_LABEL: Record<NoteSort, string> = {
  updated: "Edited: newest", "updated-asc": "Edited: oldest", created: "Created: newest", "created-asc": "Created: oldest",
};

export const isNoteSort = (v: unknown): v is NoteSort => NOTE_SORTS.includes(v as NoteSort);

/** What a sort reads off a note, whatever the client's shape of one: `updated` an ISO time or epoch ms, `created` a day or a time. */
export type Sortable = { pinned: boolean; updated: string | number; created: string; path: string };

const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

/** `notes` (pinned first, newest edit first) in `sort`'s order, pinned first in every sort; the input is never reordered. A note's
 *  `created` is often a bare day: same-day notes fall back to their path (its id starts with the time), in the same direction. */
export function sortNotes<T>(notes: readonly T[], sort: NoteSort, of: (n: T) => Sortable): readonly T[] {
  if (sort === "updated") return notes;
  const dir = sort === "created" ? -1 : 1;
  const key = (s: Sortable) => (sort === "updated-asc" ? s.updated : s.created);
  return [...notes].sort((x, y) => {
    const a = of(x), b = of(y);
    return Number(b.pinned) - Number(a.pinned) || dir * (cmp(key(a), key(b)) || cmp(a.path, b.path));
  });
}
