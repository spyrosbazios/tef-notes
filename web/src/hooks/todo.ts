// Tasks as TanStack Query state, over the local copy: one list (a personal list is small), read from the copy and never from the
// server. A write is made on the copy and shows at once (lib/records.ts); the sync (packages/core/src/sync.ts) sends it at the
// rev it was based on and, when another device moved the task on, merges the two field by field with the edit made here winning
// a field both changed (`mergeRecord`), so a write here never meets a conflict. `rev` is the server's as of the last sync: 0 for
// a task made here and not up yet.
import { queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { inheritTags, inLens } from "@/core/lens";
import { localDay } from "@/core/days";
import { views, type TaskPatch, type Views } from "@/core/todo";
import * as records from "@/lib/records";
import { LOCAL_QUERY, opened, readTasks, TASKS } from "@/lib/records";
import type { TaskRec } from "@/services/todo";
import { activeLensOf, useActiveLens } from "./lens";
import { useNow } from "./now";

export { TASKS, readTasks } from "@/lib/records";
export { changeTask, editTask, tickTask } from "@/lib/records";

export const tasksQuery = queryOptions({ queryKey: TASKS, queryFn: async () => { await opened(); return readTasks(); }, ...LOCAL_QUERY });

export const useTasks = () => useQuery(tasksQuery);

/** `YYYY-MM-DD` today, local, moving on at midnight. */
export function useToday(): string {
  const now = useNow(30_000);
  return useMemo(() => localDay(now), [now]);
}

/** The tasks inside the lens that is on (all of them when none is). Code that must reach a task whatever the lens says (one
 *  opened by its address) reads `useTasks`. */
export function useLensTasks(): { data: TaskRec[]; isPending: boolean } {
  const t = useTasks(), lens = useActiveLens();
  const data = useMemo(() => (lens ? (t.data ?? []).filter((x) => inLens(lens, x)) : (t.data ?? [])), [t.data, lens]);
  return { data, isPending: t.isPending };
}

/** Things' lists, sorted from the records in the lens that is on. */
export function useViews(): { views: Views; today: string; isPending: boolean } {
  const t = useLensTasks(), today = useToday();
  return { views: useMemo(() => views(t.data, today), [t.data, today]), today, isPending: t.isPending };
}

// ---- writes (lib/records.ts)

/** A new open task at the end of the open ones; under a lens it carries the lens's first tag. Throws on a value the server
 *  would refuse. */
export const addTask = (qc: QueryClient, fields: TaskPatch & { title: string }) =>
  records.addTask({ ...fields, tags: inheritTags(activeLensOf(qc), fields.tags) });

/** Gone from the lists now, from the server on the next sync, if nobody changed it since (else it comes back). Its links go with it. */
export const removeTask = (t: Pick<TaskRec, "id">) => records.removeTask(t.id);
