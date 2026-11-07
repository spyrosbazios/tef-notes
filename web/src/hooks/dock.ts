// The assistant's dock as this browser keeps it: open or not, how wide, and which chat is the current one (so a reload
// comes back to the thread). Per browser, like the agent's settings.
import { persisted } from "./store";

export const DOCK_WIDTH = { min: 320, max: 640, init: 400 } as const;

export const clampWidth = (w: number) => Math.min(DOCK_WIDTH.max, Math.max(DOCK_WIDTH.min, Math.round(w)));

type Dock = { open: boolean; width: number; chat?: string };

const dock = persisted<Dock>("tefnotes.dock", (p) => ({
  // Docked beside the page from `xl` up: a first visit there starts with it open. Narrower, it covers the page: closed
  open: typeof p.open === "boolean" ? p.open : matchMedia("(min-width: 1280px)").matches,
  width: typeof p.width === "number" && Number.isFinite(p.width) ? clampWidth(p.width) : DOCK_WIDTH.init,
  chat: typeof p.chat === "string" && p.chat ? p.chat : undefined,
}));

export const useDock = dock.use;
export const dockNow = dock.read;
export const setDock = dock.set;
export const onDock = dock.subscribe;
