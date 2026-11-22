// Whether Talk's small panel at a window's corner is open (components/talk/panel.tsx): the assistant's button opens it (core/prefs.ts
// `desktop.fab`), its Close and Expand close it. A window's state, so neither stored nor shared.
import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

export function setTalkPanel(next: boolean) {
  if (next === open) return;
  open = next;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const useTalkPanel = (): boolean => useSyncExternalStore(subscribe, () => open);
