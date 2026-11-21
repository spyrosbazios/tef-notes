// The app itself, as the assistant's card-less tools use it (core/assistant.ts `UiToolName`): opening a note or a task, moving
// to a view, editing the drawing that is open, pressing its Save. One definition for both callers — the Ask panel's chat
// (components/assistant/provider.tsx) and the spoken conversation (components/talk/provider.tsx), which lives above the routes
// and so has no screen to ask — and one way for both to read where the app is (`useNavNow`), since a tool call is answered
// from a callback that outlives the render that made it.
import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { uiError, UI_OK, type OpenDrawing } from "@/core/assistant";
import { DRAWING_LIMITS, type DrawEdit } from "@/core/drawing";
import { isDrawing } from "@/core/photos";
import { drawingNow, liveFor, liveNow, openDrawing, saveDrawing, saverNow } from "@/hooks/drawing";
import { photoListQuery } from "@/hooks/photos";
import { NOTES } from "@/hooks/notes";
import { TASKS } from "@/hooks/todo";
import { setDock } from "@/hooks/dock";
import type { UiHost } from "@/lib/assistant";
import { useNav } from "@/lib/nav";
import { syncNow } from "@/lib/sync";
import type { NoteRec } from "@/services/notes";
import type { TaskRec } from "@/services/todo";

/** A record from the cache, else from the server (the agent may have just made it and the live feed not yet told us): a sync brings
 *  it into the local copy, and so into the cache. */
async function find<T>(qc: QueryClient, key: QueryKey, is: (r: T) => boolean): Promise<T | undefined> {
  const held = () => qc.getQueryData<T[]>(key)?.find(is);
  if (held()) return held();
  await syncNow();
  return held();
}

/** The drawing open in the editor, as the context carries it; undefined when none is, or its note isn't in the cache. */
export function openDrawingNow(notes: NoteRec[] | undefined): OpenDrawing | undefined {
  const l = liveNow(), n = l && notes?.find((x) => x.note.id === l.noteId);
  if (!l || !n) return undefined;
  const { shapes, selected } = l.shapes(), shown = shapes.slice(0, DRAWING_LIMITS.shown);
  return {
    path: n.path, ...(l.name ? { name: l.name } : {}), shapes: shown, ...(shapes.length > shown.length ? { more: shapes.length - shown.length } : {}),
    ...(selected.length ? { selected } : {}), ...(drawingNow().unsaved ? { unsaved: true as const } : {}),
  };
}

/** Where the app is, kept current: what a tool's answer reads when it lands, not what was on screen when it was asked. */
export function useNavNow(): RefObject<ReturnType<typeof useNav>> {
  const nav = useNav(), now = useRef(nav);
  useEffect(() => { now.current = nav; });
  return now;
}

/** The app's tools, done here: a call to open something, and a drawing edited on the canvas that is open over its note. */
export function useUiHost(navNow: RefObject<ReturnType<typeof useNav>>): UiHost {
  const qc = useQueryClient();
  return useMemo<UiHost>(() => ({
    note: (path) => find<NoteRec>(qc, NOTES, (n) => n.path === path),
    task: (id) => find<TaskRec>(qc, TASKS, (t) => t.id === id),
    nav: {
      // Below `md` the dock covers the page: a note or a view leaves the Ask step (dock.tsx `useAskStep`), uncovering what was opened; a task is a drawer over the dock
      openNote: (id) => navNow.current.openNote(id),
      showTask: (id) => navNow.current.showTask(id),
      goView: (v) => navNow.current.goView(v),
    },
    showAssistant: () => setDock({ open: true }),
    // The drawing named (else the one open over the note, else a new one) opens over its note, and the edit is made on it, unsaved
    draw: async ({ path, name, add, update, remove }: { path: string; name?: string } & DrawEdit) => {
      const n = await find<NoteRec>(qc, NOTES, (x) => x.path === path);
      if (!n) return uiError(`No note ${path}.`);
      const id = n.note.id;
      if (name) {
        const there = (await qc.fetchQuery(photoListQuery(id))).filter((p) => isDrawing(p.name)).map((p) => p.name);
        if (!there.includes(name)) return uiError(`${path} has no drawing ${name}${there.length ? ` (it has ${there.join(", ")})` : ""}. Leave the name out to start a new one.`);
      }
      const { opened: o, unsaved } = drawingNow(), same = !!o && o.noteId === id && (!name || o.name === name);
      if (o && !same && unsaved) return uiError("Another drawing is open with changes not saved yet: ask the owner to save or close it first. Nothing was drawn.");
      navNow.current.openNote(id);
      const at = same ? o.seq : await openDrawing(id, name ?? null);
      if (at === null) return uiError("The owner kept the drawing that was open, with changes not saved yet. Nothing was drawn.");
      const live = await liveFor(at);
      if (!live) return uiError("The drawing editor didn't open in time. Nothing was drawn.");
      const r = await live.apply({ add, update, remove });
      if ("error" in r) return uiError(`${r.error} Nothing was drawn.`);
      return r.picture ? { ok: true, picture: r.picture } : UI_OK;
    },
    // Only the drawing open over that note, by the same Save the owner presses (drawing-layer.tsx)
    saveDrawing: async (path: string) => {
      const n = await find<NoteRec>(qc, NOTES, (x) => x.path === path), o = drawingNow().opened, s = saverNow();
      if (!n || !o || o.noteId !== n.note.id || s?.seq !== o.seq) return { error: `No drawing is open over ${path}: open one with draw first.` };
      const r = await saveDrawing();
      return "error" in r ? r : { ok: true, name: r.name };
    },
  }), [qc, navNow]);
}
