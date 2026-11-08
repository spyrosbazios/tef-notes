// Lenses (core/lens.ts) as state: the definitions are TanStack Query state like the tag definitions, the active lens is this
// browser's own (localStorage, hooks/store.ts), and none is the unfiltered app. The lists read the active lens through
// `useActiveLens`; code outside a component (a new note, a new task) reads it with `activeLensOf`.
import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { activeLens, type Lens, type LensFields } from "@/core/lens";
import * as lenses from "@/services/lenses";
import { persisted } from "./store";

export const LENSES = ["lenses"] as const;

export const lensesQuery = queryOptions({ queryKey: LENSES, queryFn: lenses.list, refetchOnWindowFocus: true });

export const useLenses = () => useQuery(lensesQuery);

const chosen = persisted<{ lens?: string }>("tefnotes.lens", (p) => ({ lens: typeof p.lens === "string" && p.lens ? p.lens : undefined }));

/** Turn the lens `rec` on, or none with null. */
export const setActiveLens = (rec: string | null) => chosen.set({ lens: rec ?? undefined });

/** The lens this browser has on: null when none is, and while the definitions load or when the chosen one is gone (deleted
 *  from another device). */
export function useActiveLens(): Lens | null {
  const [{ lens }] = chosen.use();
  const { data } = useLenses();
  return useMemo(() => activeLens(data ?? [], lens), [data, lens]);
}

/** The same, for code outside a component. */
export const activeLensOf = (qc: QueryClient): Lens | null => activeLens(qc.getQueryData<Lens[]>(LENSES) ?? [], chosen.read().lens);

function useChange<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: LENSES }) });
}

export const useCreateLens = () => useChange((l: LensFields) => lenses.create(l));
export const useUpdateLens = () => useChange((v: { rec: string; fields: LensFields }) => lenses.update(v.rec, v.fields));
export const useRemoveLens = () => useChange((l: Lens) => lenses.remove(l.rec));
