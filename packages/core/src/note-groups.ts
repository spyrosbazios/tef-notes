// Notes grouped under their tags, for the phone's and the web's grouped views and its tag filter. Pure: it takes notes already in
// list order (pinned first, then newest) and keeps that order inside every group, so a pinned note stays on top of each group
// it is in. A note with several tags is in each group; one with none is in the "No tag" group, last.
import { fold } from "./notes";

/** The filter's and a group's key for the notes that carry no tag (no tag can be named ""). */
export const NO_TAG = "";

export type Group<N> = { tag: string; notes: N[] };

const has = (tags: string[], name: string) => tags.some((t) => fold(t) === fold(name));

/** Whether a note falls under a tag filter: no choice all; `NO_TAG` alone the untagged; else the note carries any chosen
 *  tag (case and tonos ignored). */
export function inGroup(tags: string[], sel: readonly string[]): boolean {
  if (!sel.length) return true;
  if (sel.some((s) => s === NO_TAG)) return !tags.length;
  return sel.some((s) => has(tags, s));
}

/** The groups of `notes`: one per name in `order` that has notes, in that order, then "No tag". `only` keeps just those
 *  groups (none: all of them). */
export function groupNotes<N extends { tags: string[] }>(notes: readonly N[], order: readonly string[], only: readonly string[] = []): Group<N>[] {
  const out: Group<N>[] = [];
  for (const tag of order) {
    if (only.length && !only.some((o) => fold(o) === fold(tag))) continue;
    const ns = notes.filter((n) => has(n.tags, tag));
    if (ns.length) out.push({ tag, notes: ns });
  }
  const bare = notes.filter((n) => !n.tags.length);
  if (bare.length && (!only.length || only.some((o) => o === NO_TAG))) out.push({ tag: NO_TAG, notes: bare });
  return out;
}

/** `set` with `tag` in it or out, ignoring case and tonos. */
export function flipped(set: string[], tag: string): string[] {
  return set.some((t) => fold(t) === fold(tag)) ? set.filter((t) => fold(t) !== fold(tag)) : [...set, tag];
}
