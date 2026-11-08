// Tasks as TanStack Query state, over the local copy (lib/local.ts): one list (a personal list is small), read from the copy and
// never from the server. A write is made on the copy and shows at once; the sync (lib/sync.ts, packages/core/src/sync.ts) sends it
// at the rev it was based on and, when another device moved the task on, merges the two field by field with the edit made here
// winning a field both changed (`mergeRecord`), so a write here never meets a conflict. `rev` is the server's as of the last
// sync: 0 for a task made here and not up yet.
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { inheritTags, inLens } from "@/core/lens";
import { recordId } from "@/core/pocketbase";
import { removeTask as dropTask, saveTask, carryLinks } from "@/core/sync";
import { localDay } from "@/core/time";
import { complete, newTask, nextOrder, patchTask, reopen, taskOf, views, type Task, type TaskPatch, type Views } from "@/core/todo";
import { local } from "@/lib/local";
import { edited, LOCAL_QUERY, opened, syncing } from "@/lib/sync";
import type { TaskRec } from "@/services/todo";
import { activeLensOf, useActiveLens } from "./lens";
import { projectLinks } from "./links";
import { useNow } from "./now";

export const TASKS = ["tasks"] as const;

/** A task as the lists read it. */
const recOf = (id: string): TaskRec => {
  const r = local.tasks.get(id)!;
  return { ...taskOf(r.data), rev: r.rev ?? 0 };
};

/** Every task not deleted here, by `order`. */
export function readTasks(): TaskRec[] {
  return local.tasks.all().filter((r) => !r.deleted).map((r) => recOf(r.id)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export const projectTasks = (qc: QueryClient) => qc.setQueryData<TaskRec[]>(TASKS, readTasks());

export const useTasks = () => useQuery({ queryKey: TASKS, queryFn: async () => { await opened(); return readTasks(); }, ...LOCAL_QUERY });

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

// ---- writes

const GONE = "This was deleted on another device.";

/** The task as the copy holds it; throws when it is gone (the sync took the server's delete). */
function held(id: string): Task {
  const r = local.tasks.get(id);
  if (!r || r.deleted) throw new Error(GONE);
  return taskOf(r.data);
}

/** The copy changed: shown, and counted for the next sync. */
function changed(qc: QueryClient, links = false) {
  projectTasks(qc);
  if (links) projectLinks(qc);
  edited();
}

const open = () => [...local.tasks.all()].filter((r) => !r.deleted && !r.data.done).map((r) => r.data);

/** A new open task at the end of the open ones; under a lens it carries the lens's first tag. Throws on a value the server
 *  would refuse. */
export async function addTask(qc: QueryClient, fields: TaskPatch & { title: string }): Promise<TaskRec> {
  const t = newTask(recordId(), { order: nextOrder(open()), ...fields, tags: inheritTags(activeLensOf(qc), fields.tags) });
  saveTask(local, t);
  changed(qc);
  return recOf(t.id);
}

/** `edit` applied to the task as the copy holds it, and written there. `edit` throws to stop (a value the server would refuse). */
export async function changeTask(qc: QueryClient, id: string, edit: (t: Task) => Task): Promise<TaskRec> {
  const next = edit(held(id));
  saveTask(local, next);
  changed(qc);
  return recOf(id);
}

export const editTask = (qc: QueryClient, id: string, patch: TaskPatch) => changeTask(qc, id, (t) => patchTask(t, patch));

/** Gone from the lists now, from the server on the next sync, if nobody changed it since (else it comes back). Its links go with it. */
export async function removeTask(qc: QueryClient, t: TaskRec): Promise<void> {
  dropTask(local, t.id, syncing());
  changed(qc, true);
}

/** Tick or untick. A repeating task is done as it is, and its next round is made with it: a new record, about what the round just
 *  done was about (its links, made again from it). */
export async function tickTask(qc: QueryClient, id: string, done: boolean): Promise<void> {
  const cur = held(id), r = done ? complete(cur, localDay(), recordId) : { task: reopen(cur), next: undefined };
  saveTask(local, r.task);
  if (r.next) {
    saveTask(local, { ...r.next, order: nextOrder(open()) });
    carryLinks(local, id, r.next.id, recordId);
  }
  changed(qc, !!r.next);
}
