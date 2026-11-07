// A task just ticked stays in its list a moment, faded, and then leaves (Things does the same): `lingering` holds it for
// that while, as it was. Shared by the list and the open task, so a tick from either fades the same row.
import { useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Task } from "@/core/todo";
import { message } from "@/services/api";
import { tickTask } from "./todo";

/** How long a ticked task stays in the list before it leaves. */
const LINGER = 1500;

/** The task as it was, and the box as it shows. */
export type Lingering = { task: Task; checked: boolean };

let state: ReadonlyMap<string, Lingering> = new Map();
const subscribers = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

const set = (next: ReadonlyMap<string, Lingering>) => { state = next; subscribers.forEach((f) => f()); };
const forget = (id: string) => { const n = new Map(state); n.delete(id); set(n); };

export const useLingering = (): ReadonlyMap<string, Lingering> =>
  useSyncExternalStore((f) => { subscribers.add(f); return () => { subscribers.delete(f); }; }, () => state);

/** Tick the task, or untick it when it shows ticked; it lingers where it was for a moment either way. */
export async function toggleTask(qc: QueryClient, task: Task): Promise<void> {
  const cur = state.get(task.id), checked = !(cur ? cur.checked : !!task.done);
  clearTimeout(timers.get(task.id));
  set(new Map(state).set(task.id, { task: cur?.task ?? task, checked }));
  try {
    await tickTask(qc, task.id, checked);
    timers.set(task.id, setTimeout(() => forget(task.id), LINGER));
  } catch (e) { forget(task.id); toast.error(message(e)); }
}
