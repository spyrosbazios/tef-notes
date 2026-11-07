// Dragging a task to a new place in a list, as writes to `order` (todo.ts): the list's own `order` values dealt
// out again, in the new sequence, so a task outside the list keeps its place relative to the list as a whole and only
// the tasks that actually moved are written. Values stay whole and strictly rising, whatever ties the list held.
export type Ordered = { id: string; order: number };

/** `list` as shown (by `order`); the one at `from` dropped at `to`. The `{ id, order }` to write; none when it didn't move. */
export function reorder(list: Ordered[], from: number, to: number): Ordered[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [];
  const moved = [...list];
  moved.splice(to, 0, ...moved.splice(from, 1));
  const slots = list.map((t) => t.order).sort((a, b) => a - b);
  const out: Ordered[] = [];
  let prev = -Infinity;
  moved.forEach((t, i) => {
    prev = Math.max(slots[i], prev + 1);
    if (t.order !== prev) out.push({ id: t.id, order: prev });
  });
  return out;
}

/** Where a row picked up at `from` lands, in the list without it, when dropped before (or `after`) the row at `over`:
 *  the `to` that `reorder` takes, for a drop that names a neighbour and a side rather than a slot. */
export function landing(from: number, over: number, after: boolean): number {
  const at = over + (after ? 1 : 0);
  return from < at ? at - 1 : at;
}
