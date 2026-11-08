// A task just ticked waits a moment before it is written, shown ticked and faded in its list (Things does the same, and so does
// the phone: mobile/src/store/ticks.ts): a second tap on its box inside `TICK_MS`, or the toast's Undo (a touch screen has no
// hover to see the box by), takes the tick back and nothing is written. Once the time is up the write goes out (the rev
// compare-and-swap in hooks/todo.ts, which rolls a repeating task over) and the row leaves, at the place it had. An untick is
// written at once and lingers the same moment. `lingering` holds the row for that while, as it was; shared by the list and the
// open task, so a tick from either fades the same row. The wait's timing is core/tick.ts.
import { useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ticker, TICK_MS } from "@/core/tick";
import type { Task } from "@/core/todo";
import { flushLocal } from "@/lib/local";
import { message } from "@/services/api";
import { touching } from "./media";
import { tickTask } from "./todo";

/** How long an unticked task stays in the list before it leaves. */
const LINGER = 1500;

/** The task as it was, and the box as it shows. */
export type Lingering = { task: Task; checked: boolean };

let state: ReadonlyMap<string, Lingering> = new Map();
const subscribers = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const clients = new Map<string, QueryClient>();

const set = (next: ReadonlyMap<string, Lingering>) => { state = next; subscribers.forEach((f) => f()); };
const forget = (id: string) => { const n = new Map(state); n.delete(id); set(n); };

export const useLingering = (): ReadonlyMap<string, Lingering> =>
  useSyncExternalStore((f) => { subscribers.add(f); return () => { subscribers.delete(f); }; }, () => state);

/** The wait is over: the tick is written, and the row leaves whether it was or not (a refused one shows as it was). */
const waiting = ticker((id) => {
  const qc = clients.get(id);
  clients.delete(id);
  if (!qc) return;
  void tickTask(qc, id, true).catch((e) => toast.error(message(e))).finally(() => forget(id));
});

// A timer may not get to run once the page is hidden: write what is waiting now. The write is to the local copy, whose own flush
// to IndexedDB (lib/local.ts) is listening to the same events and, being registered first, has already run: it is asked again,
// so the tick is stored before the page goes. The sync that sends it is the visibility listener lib/sync.ts adds, which runs after.
const hide = () => { waiting.flush(); void flushLocal(); };
addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") hide(); });
addEventListener("pagehide", hide);

const toastId = (id: string) => `tick:${id}`;

/** Tick the task, or take the tick back while it waits; untick it when it shows ticked and is written. */
export async function toggleTask(qc: QueryClient, task: Task): Promise<void> {
  const cur = state.get(task.id), checked = !(cur ? cur.checked : !!task.done);
  clearTimeout(timers.get(task.id));
  if (checked) {
    set(new Map(state).set(task.id, { task: cur?.task ?? task, checked }));
    clients.set(task.id, qc);
    waiting.toggle(task.id);
    navigator.vibrate?.(8);
    if (touching()) {
      toast(`“${task.title}” done`, { id: toastId(task.id), duration: TICK_MS, action: { label: "Undo", onClick: () => { void toggleTask(qc, task); } } });
    }
    return;
  }
  if (waiting.cancel(task.id)) {
    clients.delete(task.id);
    toast.dismiss(toastId(task.id));
    forget(task.id);
    return;
  }
  set(new Map(state).set(task.id, { task: cur?.task ?? task, checked }));
  try {
    await tickTask(qc, task.id, false);
    timers.set(task.id, setTimeout(() => forget(task.id), LINGER));
  } catch (e) { forget(task.id); toast.error(message(e)); }
}
