// A note's drawing, edited in Excalidraw on a layer over the note's page (note-pane.tsx): the scene's JSON and a PNG of it are
// attachments of the note (hooks/photos.ts useDrawings). Not a dialog: it covers the note only, so the assistant's dock stays
// beside it and the agent draws on the same canvas as the owner (core/assistant.ts "the drawing"). What is open, whether it holds
// unsaved changes, closing and saving are hooks/drawing.ts's, so the agent can open and save one too. A new one (`name` null)
// becomes a drawing of the note on its first Save, which hands its body line up; Save keeps the editor open. Close, and leaving the
// note any way (the agent's open_note, ⌘K, Back), ask first when changes are unsaved; a reload or a closed tab asks the browser's
// way. Excalidraw loads on first use, a chunk of its own; a throw inside it leaves the header, and so Close, in place.
import { Loader2 } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Boundary } from "@/components/boundary";
import { Loaded } from "@/components/loaded";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { readScene } from "@/core/drawing";
import { answerDrawingClose, requestDrawingClose, saveDrawing, savedAs, saverNow, setSaver, useDrawing, useDrawingGuard, type Opened } from "@/hooks/drawing";
import { useDrawings } from "@/hooks/photos";
import type { Saved } from "@/lib/drawing-store";
import { message } from "@/services/api";
import type { DrawingHandle } from "./drawing-canvas";

const Canvas = lazy(() => import("./drawing-canvas"));

type Props = {
  /** The drawing open over this note; the layer is keyed by its `seq`, so each opening starts afresh. */
  opened: Opened;
  /** A new drawing was saved: the body line that links it. */
  onCreated: (markdown: string) => void;
};

function Waiting() {
  return <Skeleton role="status" aria-label="Opening the drawing" className="size-full rounded-none" />;
}

export function DrawingLayer({ opened, onCreated }: Props) {
  const { noteId, name, seq } = opened;
  const drawings = useDrawings(noteId), canvas = useRef<DrawingHandle>(null);
  const { unsaved, asking, saving } = useDrawing();
  useDrawingGuard(noteId);
  // The scene it opened on (undefined while it loads): a new one, once saved, stays this canvas and isn't loaded again
  const [initial, setInitial] = useState<Record<string, unknown> | null | undefined>(name ? undefined : null);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef(name);

  useEffect(() => {
    if (!file.current) return;
    let live = true;
    drawings.load(file.current).then((t) => {
      if (!live) return;
      const r = readScene(t);
      if ("scene" in r) setInitial(r.scene); else setErr(`Couldn’t open it: ${r.error}.`);
    }, (e) => { if (live) setErr(`Couldn’t open it: ${message(e)}`); });
    return () => { live = false; };
  }, [drawings]);

  // The Save of this opening, as the store runs it (one at a time, for ⌘S, the button and the assistant's save_drawing alike):
  // the canvas uploaded under `saved` (the store's name for it, null while new); answers why not (shown too) or the drawing's file
  const latest = useRef({ drawings, onCreated });
  useEffect(() => { latest.current = { drawings, onCreated }; });
  useEffect(() => {
    const save = async (saved: string | null): Promise<Saved> => {
      setErr(null);
      const fail = (error: string) => { setErr(error); return { error }; };
      const { drawings: d, onCreated: created } = latest.current;
      try {
        const snap = await canvas.current?.snapshot();
        if (!snap) return fail("Draw something first.");
        let as = saved;
        if (as) await d.save(as, snap.scene, snap.preview);
        else {
          const made = await d.create(snap.scene, snap.preview);
          as = made.name;
          savedAs(made.name);
          created(made.markdown);
        }
        canvas.current?.saved();
        return { name: as };
      } catch (e) { return fail(`Not saved: ${message(e)}`); }
    };
    const mine = { seq, save };
    setSaver(mine);
    return () => { if (saverNow() === mine) setSaver(null); };
  }, [seq]);

  // ⌘S / Ctrl+S saves the drawing while focus is on it
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); e.stopPropagation(); void saveDrawing(); } };
    el?.addEventListener("keydown", key);
    return () => el?.removeEventListener("keydown", key);
  }, []);

  return (
    <div ref={box} data-drawing role="region" aria-label={name ? "Edit drawing" : "New drawing"} className="absolute inset-0 z-30 flex flex-col bg-bg">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="flex-1 truncate text-sm font-semibold">
          {name ? "Edit drawing" : "New drawing"}{unsaved ? <span className="ml-2 font-normal text-faint text-xs">Unsaved</span> : null}
        </span>
        {err ? <span className="truncate text-down text-xs" role="alert">{err}</span> : null}
        <Button variant="ghost" size="sm" onClick={() => { void requestDrawingClose(); }} disabled={saving}>Close</Button>
        <Button size="sm" className="rounded-full" onClick={() => { void saveDrawing(); }} disabled={saving || initial === undefined}>
          {saving ? <Loader2 className="animate-spin" /> : null} Save
        </Button>
      </header>
      <div className="min-h-0 flex-1">
        {/* The canvas fades in over a skeleton as large as itself: the drawing's file, then the editor's chunk, are waited for */}
        <Loaded loading={initial === undefined} blurred={false} frame="h-full" className="h-full"
          skeleton={err && initial === undefined ? <p className="p-6 text-center text-faint text-sm">{err}</p> : <Waiting />}>
          <Boundary what="The drawing">
            <Suspense fallback={<Waiting />}>
              {initial !== undefined ? <Canvas ref={canvas} initial={initial} opening={opened} /> : null}
            </Suspense>
          </Boundary>
        </Loaded>
      </div>

      <AlertDialog open={asking} onOpenChange={(open) => { if (!open) answerDrawingClose(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close without saving?</AlertDialogTitle>
            <AlertDialogDescription>The changes since the last save, yours and the assistant’s, are lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep drawing</AlertDialogCancel>
            <AlertDialogAction onClick={() => answerDrawingClose(true)}>Close</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
