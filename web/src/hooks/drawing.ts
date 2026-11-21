// The drawing editor's state outside it, where the assistant can reach it (core/assistant.ts "the drawing"):
//  - its life (lib/drawing-store.ts): which drawing is open, and over which note, whether it holds unsaved changes, closing it
//    (always through `requestClose`, which asks before unsaved strokes are dropped) and saving it (one save at a time). The note's
//    page lays the editor over itself while its own is open (note-pane.tsx), the `draw` tool opens one there (hooks/ui-host.ts);
//  - the open canvas itself (`Live`), registered by the editor's chunk once Excalidraw is up (drawing-canvas.tsx): what is on it,
//    for every request's context, and the hand that makes an agent's edit on it, which answers with a picture of the result.
// The window's state, never saved: a reload closes the editor (`useDrawingGuard` asks the browser to confirm one while unsaved).
import { useBlocker } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import type { DrawEdit, Shape } from "@/core/drawing";
import { drawingStore, type DrawingState, type Opened } from "@/lib/drawing-store";

export type { Opened } from "@/lib/drawing-store";

/** The open canvas, as the assistant uses it. */
export type Live = {
  /** The opening it belongs to (`Opened.seq`). */
  seq: number;
  noteId: string;
  name: string | null;
  /** What is on it now, as shapes, and the ids the owner has selected. */
  shapes(): { shapes: Shape[]; selected: string[] };
  /** Makes the edit on the canvas, in sight and undoable; resolves to why it couldn't (nothing changed then), or to a picture of
   *  the drawing after it (a data URL; null for an empty canvas). */
  apply(edit: DrawEdit): Promise<{ error: string } | { picture: string | null }>;
};

const drawing = drawingStore();

export const {
  requestClose: requestDrawingClose, answer: answerDrawingClose, open: openDrawing, markUnsaved, savedAs, setSaver, saverNow,
  save: saveDrawing,
} = drawing;
export const drawingNow = drawing.get;

/** The editor's state, kept current. */
export function useDrawing(): DrawingState {
  return useSyncExternalStore(drawing.subscribe, drawing.get);
}

/** The drawing open over this note, if one is. */
export function useOpened(noteId: string): Opened | null {
  const o = useDrawing().opened;
  return o?.noteId === noteId ? o : null;
}

/** The note an address lays open (`?note=`, routes/_app.tsx). */
const noteOf = (search: object): string | undefined => ("note" in search && typeof search.note === "string" ? search.note : undefined);

/** While a drawing is open over the note `noteId`: leaving the note (the agent's open_note, ⌘K, Back) goes through
 *  `requestClose`, so unsaved strokes are asked about first, and the browser confirms a reload or a closed tab while they are. */
export function useDrawingGuard(noteId: string) {
  useBlocker({
    shouldBlockFn: async ({ next }) => noteOf(next.search) !== noteId && !(await requestDrawingClose()),
    enableBeforeUnload: () => drawing.get().unsaved,
  });
}

let live: Live | null = null;
const waiting = new Set<() => void>();
/** The canvas registers itself while it is up (null when it goes). */
export function setLive(l: Live | null) { live = l; waiting.forEach((w) => w()); }
export const liveNow = () => live;

/** The canvas of an opening (`seq`) once it is up (an edit has to wait for Excalidraw's chunk and the file), or null if it isn't
 *  within `ms`. */
export function liveFor(at: number, ms = 15_000): Promise<Live | null> {
  return new Promise((done) => {
    if (live?.seq === at) { done(live); return; }
    const check = () => { if (live?.seq === at) { clearTimeout(t); waiting.delete(check); done(live); } };
    waiting.add(check);
    const t = setTimeout(() => { waiting.delete(check); done(null); }, ms);
  });
}
