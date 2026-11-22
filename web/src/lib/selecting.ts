// Whether a list on a phone has notes selected (components/note-list.tsx): then its actions take the tab pill's place at the bottom
// (note-actions.tsx `BulkDock`) and the shell hides the pill (shell.tsx). A window's state, so neither stored nor shared.
import { useSyncExternalStore } from "react";

let on = false;
const listeners = new Set<() => void>();

export function setSelecting(next: boolean) {
  if (next === on) return;
  on = next;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const useSelecting = (): boolean => useSyncExternalStore(subscribe, () => on);
