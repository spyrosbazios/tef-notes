// Doing one thing to many notes at once (the list's multi-select), on both apps: what a button's patch is when the
// notes disagree, how a tag stands across them, and how a selection grows. Pure: each app applies the result its own
// way (the phone to SQLite, the laptop over the server's rev check).
import { fold, type Color } from "./notes";

type Flagged = { pinned: boolean };

/** All pinned → unpin them all; otherwise pin the ones that aren't. One state for every note, so a mixed set ends up equal. */
export const pinPatch = (ns: Flagged[]): { pinned: boolean } => ({ pinned: !ns.every((n) => n.pinned) });

/** The same colour on every note, its card's tint in the list; null takes the tint off. */
export const colorPatch = (color: Color | null): { color: Color | null } => ({ color });

export type TagState = "all" | "some" | "none";

/** Whether `name` is on every one of the notes (each one's tags), some, or none. Case and tonos ignored. */
export function tagState(lists: string[][], name: string): TagState {
  const n = lists.filter((l) => l.some((t) => fold(t) === fold(name))).length;
  return n === 0 ? "none" : n === lists.length ? "all" : "some";
}

/** What tapping a tag does across the notes: on all of them → take it off; otherwise put it on the ones without. */
export const tagChange = (lists: string[][], name: string): { add: string[]; remove: string[] } =>
  tagState(lists, name) === "all" ? { add: [], remove: [name] } : { add: [name], remove: [] };

/** Every tag any of the notes carries, spelt as first seen, one per name. */
export function tagUnion(lists: string[][]): string[] {
  const seen = new Map<string, string>();
  for (const t of lists.flat()) if (!seen.has(fold(t))) seen.set(fold(t), t);
  return [...seen.values()];
}

/** A selection with `x` toggled. */
export const toggled = <T>(sel: readonly T[], x: T): T[] => (sel.includes(x) ? sel.filter((s) => s !== x) : [...sel, x]);

/** `order`'s items from `from` through `to`, either way round: a shift-click's range. Just `to` when `from` isn't there. */
export function between<T>(order: readonly T[], from: T | undefined, to: T): T[] {
  const a = from === undefined ? -1 : order.indexOf(from), b = order.indexOf(to);
  if (b < 0) return [];
  if (a < 0) return [to];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}
