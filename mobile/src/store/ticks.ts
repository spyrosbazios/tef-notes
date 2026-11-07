// A tick on a task waits a moment before it is written: the row shows it done, and a second tap within TICK_MS takes it
// back, so a slip never reaches the Logbook (nor, for a repeating task, makes its next round). Once the time is up the
// task is completed (store/todo.ts) and its row leaves the list. An untick is written at once.
import { AppState } from "react-native";
import { create } from "zustand";
import { useTodo } from "./todo";

/** How long a tick shows before it is written. */
export const TICK_MS = 1500;

const pending = new Map<string, ReturnType<typeof setTimeout>>();

/** Ids of tasks ticked and waiting: drawn done. */
export const useTicking = create<{ ids: Record<string, true> }>()(() => ({ ids: {} }));

const leave = (id: string) => useTicking.setState((s) => { const ids = { ...s.ids }; delete ids[id]; return { ids }; });

function settle(id: string) {
  const timer = pending.get(id);
  if (timer === undefined) return;
  clearTimeout(timer);
  pending.delete(id);
  useTodo.getState().complete(id);
  leave(id);
}

/** Tick an open task (written after TICK_MS; ticked again before that, it stays open), or untick a done one at once. */
export function toggleTask(id: string) {
  const t = useTodo.getState().tasks[id];
  if (!t) return;
  if (t.done) { useTodo.getState().reopen(id); return; }
  const timer = pending.get(id);
  if (timer !== undefined) { clearTimeout(timer); pending.delete(id); leave(id); return; }
  pending.set(id, setTimeout(() => settle(id), TICK_MS));
  useTicking.setState((s) => ({ ids: { ...s.ids, [id]: true } }));
}

/** Ticks still waiting are written now: the app is going to the background, where a timer may not get to run. */
AppState.addEventListener("change", (s) => { if (s !== "active") for (const id of [...pending.keys()]) settle(id); });
