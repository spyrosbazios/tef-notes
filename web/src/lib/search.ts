import { fold } from "@/core/notes";
import { matchesTags, parseTagQuery } from "@/core/tags";
import type { NoteRec } from "@/services/notes";

/** Notes holding every word of `q` in title, tags or body, folded as the phone folds them (case, accents, tonos).
 *  A `#word` is a tag the note must carry (a prefix while it's being typed): `#home keys`. `chips` are tags already
 *  chosen, carried exactly. */
export function matches(q: string, chips: string[] = []): (n: NoteRec) => boolean {
  const { tags, text } = parseTagQuery(q);
  const words = fold(text).split(/\s+/).filter(Boolean);
  if (!words.length && !tags.length && !chips.length) return () => true;
  return (n) => {
    if (!matchesTags(n.note.tags, tags) || !matchesTags(n.note.tags, chips, true)) return false;
    const hay = fold(`${n.note.title}\n${n.note.tags.join(" ")}\n${n.note.body}`);
    return words.every((w) => hay.includes(w));
  };
}

/** Server timestamps (`2026-10-19 10:00:00.123Z`) as ms. */
export const ms = (t: string) => Date.parse(t.replace(" ", "T"));
