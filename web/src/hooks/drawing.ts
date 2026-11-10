// The drawing editor's state outside it, where the assistant can reach it (core/assistant.ts "the drawing"):
//  - which drawing is open, and over which note: the note's page lays the editor over itself while its own is (note-pane.tsx),
//    and the `draw` tool opens one there (lib/assistant.ts);
//  - the open canvas itself (`Live`), registered by the editor's chunk once Excalidraw is up (drawing-canvas.tsx): what is on it,
//    for every request's context, and the hand that makes an agent's edit on it, which answers with a picture of the result.
// The window's state, never saved: a reload closes the editor, as it closed the dialog it replaced.
import { useSyncExternalStore } from "react";
import type { DrawEdit, Shape } from "@/core/drawing";

/** The drawing open in the editor: the note it is in (by id), its file (null: new, not saved yet). `seq` tells two openings of
 *  the same drawing apart, so a second one reloads it. */
export type Opened = { noteId: string; name: string | null; seq: number };

/** The open canvas, as the assistant uses it. */
export type Live = {
  /** The opening it belongs to (`Opened.seq`). */
  seq: number;
  noteId: string;
  name: string | null;
  /** What is on it now, as shapes, and the ids the owner has selected. */
  shapes(): { shapes: Shape[]; selected: string[] };
  /** Whether it holds changes not saved yet. */
  unsaved(): boolean;
  /** Makes the edit on the canvas, in sight and undoable; resolves to why it couldn't (nothing changed then), or to a picture of
   *  the drawing after it (a data URL; null for an empty canvas). */
  apply(edit: DrawEdit): Promise<{ error: string } | { picture: string | null }>;
};

function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) { value = next; listeners.forEach((l) => l()); },
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}

const opened = store<Opened | null>(null);
let seq = 0;

/** Opens a drawing of the note in the editor (its file, or null for a new one); returns the opening's `seq`. */
export function openDrawing(noteId: string, name: string | null): number {
  opened.set({ noteId, name, seq: ++seq });
  return seq;
}
/** Closes the editor. */
export const closeDrawing = () => opened.set(null);
/** The drawing a new one became once saved: the editor stays on it. */
export const savedAs = (name: string) => { const o = opened.get(); if (o) opened.set({ ...o, name }); };
export const openedNow = opened.get;
/** The drawing open over this note, if one is. */
export function useOpened(noteId: string): Opened | null {
  const o = useSyncExternalStore(opened.subscribe, opened.get);
  return o?.noteId === noteId ? o : null;
}

const live = store<Live | null>(null);
/** The canvas registers itself while it is up (null when it goes). */
export const setLive = live.set;
export const liveNow = live.get;

/** The canvas of an opening (`seq`) once it is up (an edit has to wait for Excalidraw's chunk and the file), or null if it isn't
 *  within `ms`. */
export function liveFor(at: number, ms = 15_000): Promise<Live | null> {
  const fits = (l: Live | null) => l?.seq === at;
  return new Promise((done) => {
    if (fits(live.get())) { done(live.get()); return; }
    const off = live.subscribe(() => { if (fits(live.get())) { clearTimeout(t); off(); done(live.get()); } });
    const t = setTimeout(() => { off(); done(null); }, ms);
  });
}
