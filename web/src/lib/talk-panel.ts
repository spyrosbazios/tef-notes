// Whether Talk's small panel at a window's corner is open (components/talk/panel.tsx): the assistant's button opens it (core/prefs.ts
// `desktop.fab`), its Close and Expand close it. A window's state, so not shared: whether it is open isn't kept at all, the size the owner dragged it to
// is kept by this browser.
import { useSyncExternalStore } from "react";
import { persisted } from "@/hooks/store";
import { STORAGE } from "@/lib/storage-keys";

/** The panel's size in px. Its widest stays under the width where the conversation lays itself out as a page (`@3xl`); the
 *  window caps both further (panel.tsx). */
export const PANEL_SIZE = { width: { min: 320, max: 720, init: 384 }, height: { min: 400, max: 1000, init: 640 } } as const;

type Size = { width: number; height: number };
type Side = keyof Size;

export const clampSide = (side: Side, v: number) => Math.min(PANEL_SIZE[side].max, Math.max(PANEL_SIZE[side].min, Math.round(v)));

const sideOf = (side: Side, v: unknown) => (typeof v === "number" && Number.isFinite(v) ? clampSide(side, v) : PANEL_SIZE[side].init);

const size = persisted<Size>(STORAGE.talkPanel, (p) => ({ width: sideOf("width", p.width), height: sideOf("height", p.height) }));

export const useTalkPanelSize = size.use;

let open = false;
const listeners = new Set<() => void>();

export function setTalkPanel(next: boolean) {
  if (next === open) return;
  open = next;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const useTalkPanel = (): boolean => useSyncExternalStore(subscribe, () => open);
