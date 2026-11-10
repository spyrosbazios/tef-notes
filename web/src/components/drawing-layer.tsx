// A note's drawing, edited in Excalidraw on a layer over the note's page (note-pane.tsx): the scene's JSON and a PNG of it are
// attachments of the note (hooks/photos.ts useDrawings). Not a dialog: it covers the note only, so the assistant's dock stays
// beside it and the agent draws on the same canvas as the owner (core/assistant.ts "the drawing"). What is open is
// hooks/drawing.ts's, so the agent can open one too. A new one (`name` null) becomes a drawing of the note on its first Save,
// which hands its body line up; Save keeps the editor open, Close leaves it (asking first when changes are unsaved).
// Excalidraw loads on first use, a chunk of its own.
import { Loader2 } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Loaded } from "@/components/loaded";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { closeDrawing, savedAs, saverNow, setSaver, type Opened } from "@/hooks/drawing";
import { useDrawings } from "@/hooks/photos";
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
  const { noteId, name } = opened;
  const drawings = useDrawings(noteId), canvas = useRef<DrawingHandle>(null);
  // The file it opened on (undefined while it loads): a new one, once saved, stays this canvas and isn't loaded again
  const [initial, setInitial] = useState<string | null | undefined>(name ? undefined : null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const [unsaved, setUnsaved] = useState(false), [leaving, setLeaving] = useState(false);
  const file = useRef(name);

  useEffect(() => {
    if (!file.current) return;
    let live = true;
    drawings.load(file.current).then((t) => { if (live) setInitial(t); }, (e) => { if (live) setErr(`Couldn’t open it: ${message(e)}`); });
    return () => { live = false; };
  }, [drawings]);

  // Saves the canvas; answers why not (shown too) or the drawing's file. The owner's Save, ⌘S, and the assistant's save_drawing
  const save = async (): Promise<{ error: string } | { name: string }> => {
    setBusy(true); setErr(null);
    const fail = (error: string) => { setErr(error); return { error }; };
    try {
      const snap = await canvas.current?.snapshot();
      if (!snap) return fail("Draw something first.");
      let saved = name;
      if (saved) await drawings.save(saved, snap.scene, snap.preview);
      else {
        const made = await drawings.create(snap.scene, snap.preview);
        saved = made.name;
        savedAs(made.name);
        onCreated(made.markdown);
      }
      canvas.current?.saved();
      return { name: saved };
    } catch (e) { return fail(`Not saved: ${message(e)}`); } finally { setBusy(false); }
  };
  const saving = useRef(save);
  useEffect(() => { saving.current = save; });

  // The assistant's save_drawing presses the same Save, for this opening only
  useEffect(() => {
    const mine = { seq: opened.seq, save: () => saving.current() };
    setSaver(mine);
    return () => { if (saverNow() === mine) setSaver(null); };
  }, [opened.seq]);

  // ⌘S / Ctrl+S saves the drawing while focus is on it
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); e.stopPropagation(); void saving.current(); } };
    el?.addEventListener("keydown", key);
    return () => el?.removeEventListener("keydown", key);
  }, []);

  const close = () => (unsaved ? setLeaving(true) : closeDrawing());

  return (
    <div ref={box} data-drawing role="region" aria-label={name ? "Edit drawing" : "New drawing"} className="absolute inset-0 z-30 flex flex-col bg-bg">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="flex-1 truncate text-sm font-semibold">
          {name ? "Edit drawing" : "New drawing"}{unsaved ? <span className="ml-2 font-normal text-faint text-xs">Unsaved</span> : null}
        </span>
        {err ? <span className="truncate text-down text-xs" role="alert">{err}</span> : null}
        <Button variant="ghost" size="sm" onClick={close} disabled={busy}>Close</Button>
        <Button size="sm" className="rounded-full" onClick={() => void save()} disabled={busy || initial === undefined}>
          {busy ? <Loader2 className="animate-spin" /> : null} Save
        </Button>
      </header>
      <div className="min-h-0 flex-1">
        {/* The canvas fades in over a skeleton as large as itself: the drawing's file, then the editor's chunk, are waited for */}
        <Loaded loading={initial === undefined} blurred={false} frame="h-full" className="h-full"
          skeleton={err && initial === undefined ? <p className="p-6 text-center text-faint text-sm">{err}</p> : <Waiting />}>
          <Suspense fallback={<Waiting />}>
            {initial !== undefined ? <Canvas ref={canvas} initial={initial} opening={opened} onUnsaved={setUnsaved} /> : null}
          </Suspense>
        </Loaded>
      </div>

      <AlertDialog open={leaving} onOpenChange={setLeaving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close without saving?</AlertDialogTitle>
            <AlertDialogDescription>The changes since the last save, yours and the assistant’s, are lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep drawing</AlertDialogCancel>
            <AlertDialogAction onClick={closeDrawing}>Close</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
