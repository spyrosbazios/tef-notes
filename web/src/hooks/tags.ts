// The tag definitions as TanStack Query state: one list, refetched after every change made here.
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { tagColor, tagGuesser, type TagDef, type TagFields } from "@/core/tags";
import type { Color } from "@/core/notes";
import * as tags from "@/services/tags";

export const TAGS = ["tags"] as const;

export const tagsQuery = queryOptions({ queryKey: TAGS, queryFn: tags.list, refetchOnWindowFocus: true });

export const useTags = () => useQuery(tagsQuery);

/** A tag name's badge colour (gray when it has no definition). Stable across renders until the definitions change. */
export function useTagColor(): (name: string) => Color {
  const { data } = useTags();
  return useCallback((name) => tagColor(data ?? [], name), [data]);
}

function useChange<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: TAGS }) });
}

export const useCreateTag = () => useChange((t: TagFields) => tags.create(t));
export const useUpdateTag = () => useChange((v: { rec: string; fields: TagFields }) => tags.update(v.rec, v.fields));
export const useRemoveTag = () => useChange((t: TagDef) => tags.remove(t.rec));

/** A description written from the notes that carry a tag: nothing is saved, the editor shows it. */
export const useDescribeTag = () => useMutation({ mutationFn: (name: string) => tags.describe(name) });

/** A new task's tags, guessed by the server while its title and notes are typed (@/core/tags tagGuesser): they land on
 *  the form through `setTags`; call `dismiss` with a tag taken off by hand. Nothing lands once the form is gone. */
export function useGuessedTags(title: string, notes: string, setTags: (next: (tags: string[]) => string[]) => void) {
  const g = useMemo(() => tagGuesser(tags.guess, setTags), [setTags]);
  useEffect(() => g.update(title, notes), [g, title, notes]);
  useEffect(() => g.stop, [g]);
  return g.dismiss;
}
