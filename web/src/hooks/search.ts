// What a search finds, for the palette (⌘K) and the phone's drawer (components/search-drawer.tsx): the notes and tasks holding
// the words and `#tag`s typed, the tag names to complete one with, and, when words find nothing, the assistant's search by
// meaning (core/find.ts) with its hits looked up among the notes and tasks the lens lets through. `chips` are tags already
// chosen (the drawer's), carried exactly.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Found } from "@/core/find";
import { matchesTask, parseTagQuery, suggestTags, typingTag } from "@/core/tags";
import { useLensSorted } from "@/hooks/notes";
import { useTagNames } from "@/hooks/tag-names";
import { useLensTasks } from "@/hooks/todo";
import { matches } from "@/lib/search";
import { message } from "@/services/api";
import { findByAsking } from "@/services/find";

const LIMIT = 50;

export function useFinder(q: string, chips: string[] = []) {
  const notes = useLensSorted();
  const tasks = useLensTasks().data;
  const names = useTagNames();
  const wanted = [...chips.map((c) => `#${c}`), q.trim()].filter(Boolean).join(" ");

  const hits = useMemo(() => notes.filter(matches(q, chips)).slice(0, LIMIT), [notes, q, chips]);
  const taskHits = useMemo(() => tasks.filter(matchesTask(wanted)).slice(0, LIMIT), [tasks, wanted]);
  // Tag names holding what is typed, folded (case, tonos): the `#ho` being typed, else the last `#tag`, else the text.
  const tags = useMemo(() => suggestTags(names, typingTag(q) ?? parseTagQuery(q).tags.at(-1) ?? q, chips), [names, q, chips]);

  // The assistant's search for `wanted`: running, its hits, or why it failed. Typing on drops it (and stops one running).
  const [asked, setAsked] = useState<{ q: string; found?: Found; error?: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), [wanted]);
  const current = asked?.q === wanted ? asked : null;
  const ask = () => {
    abort.current?.abort();
    const c = abort.current = new AbortController(), asking = wanted;
    setAsked({ q: asking });
    findByAsking(asking, c.signal).then((found) => { if (!c.signal.aborted) setAsked({ q: asking, found }); },
      (e) => { if (!c.signal.aborted) setAsked({ q: asking, error: message(e) }); });
  };
  const byPath = useMemo(() => new Map(notes.map((n) => [n.path, n])), [notes]);
  const foundNotes = current?.found?.notes.flatMap((h) => byPath.get(h.path) ? [{ n: byPath.get(h.path)!, why: h.why }] : []) ?? [];
  const foundTasks = current?.found?.tasks.flatMap((h) => { const t = tasks.find((x) => x.id === h.id); return t ? [{ t, why: h.why }] : []; }) ?? [];
  const empty = !!wanted && !hits.length && !taskHits.length;

  return { wanted, hits, taskHits, tags, empty, asked: current, ask, foundNotes, foundTasks };
}
