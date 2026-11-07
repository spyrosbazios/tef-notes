// Tasks as TanStack Query state: one list (a personal list is small, see services/todo.ts). Writes put
// the server's reply straight into the cache and the realtime feed puts in what another device wrote. A write is
// compare-and-swap on `rev` and carries only the fields it changed; a stale one (Conflict) reads the record again and
// applies the same edit to it, never sending the old result over the newer one (as hooks/notes.ts write does).
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { inheritTags, inLens } from "@/core/lens";
import { Conflict, recordId, type Versioned } from "@/core/pocketbase";
import { localDay } from "@/core/time";
import { complete, newTask, nextOrder, patchTask, reopen, taskOf, views, type Task, type TaskPatch, type Views } from "@/core/todo";
import * as svc from "@/services/todo";
import type { Collection, TaskRec } from "@/services/todo";
import type { TodoChange } from "@/services/realtime";
import { activeLensOf, useActiveLens } from "./lens";
import { carryLinks } from "./links";
import { useNow } from "./now";

export const TASKS = ["tasks"] as const;

type Coll<T extends { id: string }> = { key: readonly string[]; api: Collection<T>; of: (r: any) => T };
const TASK: Coll<Task> = { key: TASKS, api: svc.tasks, of: taskOf };

export const useTasks = () => useQuery({ queryKey: TASKS, queryFn: svc.tasks.all, refetchOnWindowFocus: true });

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

// ---- the cache

/** A record as the server now has it, in place of the cached one (or gone, when null). */
function put<T extends { id: string }>(qc: QueryClient, c: Coll<T>, id: string, r: Versioned<T> | null) {
  qc.setQueryData<Versioned<T>[]>(c.key, (all = []) => {
    if (!r) return all.filter((x) => x.id !== id);
    return all.some((x) => x.id === id) ? all.map((x) => (x.id === id ? r : x)) : [...all, r];
  });
}

/** The cache after a write: the server's reply goes in over any refetch still out, which started before the write and
 *  would bring the record back as it was; that one is cancelled and run again once the reply is in. */
async function commit<T extends { id: string }>(qc: QueryClient, c: Coll<T>, id: string, r: Versioned<T> | null) {
  const out = qc.isFetching({ queryKey: c.key }) > 0;
  await qc.cancelQueries({ queryKey: c.key });
  put(qc, c, id, r);
  if (out) void qc.invalidateQueries({ queryKey: c.key });
}

/** A change another device made, into the cache as it came. Ours (the rev is stored already) and an older one are left out. */
function apply<T extends { id: string }>(qc: QueryClient, c: Coll<T>, { action, record: r }: TodoChange) {
  const all = qc.getQueryData<Versioned<T>[]>(c.key);
  if (!all) return;                                               // not loaded yet: its first fetch has it all
  if (action === "delete") { put(qc, c, r.id, null); return; }
  const mine = all.find((x) => x.id === r.id);
  if (!mine || mine.rev < r.rev) put(qc, c, r.id, { ...c.of(r), rev: r.rev });
}

export const applyTask = (qc: QueryClient, c: TodoChange) => apply(qc, TASK, c);

// ---- writes

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The fields `next` changed in `cur`. */
function diff<T extends { id: string }>(cur: T, next: T): Partial<Omit<T, "id">> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(next) as (keyof T & string)[]) if (k !== "id" && !same(cur[k], next[k])) out[k] = next[k];
  return out as Partial<Omit<T, "id">>;
}

async function current<T extends { id: string }>(qc: QueryClient, c: Coll<T>, id: string): Promise<Versioned<T>> {
  const hit = qc.getQueryData<Versioned<T>[]>(c.key)?.find((x) => x.id === id);
  if (hit) return hit;
  const got = await c.api.get(id);
  if (!got) throw new Error("This was deleted on another device.");
  return got;
}

/** `edit` applied to the record and written at its rev. When it moved on meanwhile, `edit` is applied again to the
 *  record as it is now. `edit` throws to stop (a value the server would refuse). */
async function change<T extends { id: string }>(qc: QueryClient, c: Coll<T>, id: string, edit: (cur: T) => T): Promise<Versioned<T>> {
  let cur = await current(qc, c, id);
  for (let i = 0; ; i++) {
    const fields = diff(cur, edit(cur));
    if (!Object.keys(fields).length) return cur;
    try {
      const out = await c.api.update(id, cur.rev, fields);
      if (!out) { await commit(qc, c, id, null); throw new Error("This was deleted on another device."); }
      await commit(qc, c, id, out);
      return out;
    } catch (e) {
      if (!(e instanceof Conflict) || i === 3) throw e;
      const now = await c.api.get(id);
      if (!now) { await commit(qc, c, id, null); throw new Error("This was deleted on another device."); }
      await commit(qc, c, id, now);
      cur = now;
    }
  }
}

async function create<T extends { id: string }>(qc: QueryClient, c: Coll<T>, r: T): Promise<Versioned<T>> {
  const out = await c.api.create(r);
  await commit(qc, c, r.id, out);
  return out;
}

/** Deleted, if nobody changed it since. Conflict: they did, and the list now shows their version. */
async function drop<T extends { id: string }>(qc: QueryClient, c: Coll<T>, r: Versioned<T>) {
  try {
    await c.api.remove(r.id, r.rev);
    await commit(qc, c, r.id, null);
  } catch (e) {
    if (e instanceof Conflict) await commit(qc, c, r.id, await c.api.get(r.id));
    throw e;
  }
}

const tasksOf = (qc: QueryClient) => qc.getQueryData<TaskRec[]>(TASKS) ?? [];

/** A new open task at the end of the open ones; under a lens it carries the lens's first tag. Throws on a value the server
 *  would refuse. */
export function addTask(qc: QueryClient, fields: TaskPatch & { title: string }): Promise<TaskRec> {
  const order = nextOrder(tasksOf(qc).filter((t) => !t.done));
  return create(qc, TASK, newTask(recordId(), { order, ...fields, tags: inheritTags(activeLensOf(qc), fields.tags) }));
}

export const changeTask = (qc: QueryClient, id: string, edit: (t: Task) => Task) => change(qc, TASK, id, edit);
export const editTask = (qc: QueryClient, id: string, patch: TaskPatch) => change(qc, TASK, id, (t) => patchTask(t, patch));
export const removeTask = (qc: QueryClient, t: TaskRec) => drop(qc, TASK, t);

/** Tick or untick. A repeating task is done as it is, and its next round is made after: a new record, about what the round
 *  just done was about (its links, made again from it). */
export async function tickTask(qc: QueryClient, id: string, done: boolean): Promise<void> {
  const today = localDay(), made: { next?: Task } = {};
  await change(qc, TASK, id, (t) => {
    if (!done) { made.next = undefined; return reopen(t); }
    const r = complete(t, today, recordId);
    made.next = r.next;
    return r.task;
  });
  const next = made.next;
  if (!next) return;
  await create(qc, TASK, { ...next, order: nextOrder(tasksOf(qc).filter((t) => !t.done)) });
  await carryLinks(qc, id, next.id);
}
