// A note's drawing, edited in Excalidraw in a full-screen dialog: the scene's JSON and a PNG of it are attachments of the
// note (hooks/photos.ts useDrawings). Opened on a drawing (`name`) or a blank one (`name` null: saving makes the
// drawing and hands its body line up). Excalidraw loads on first use, a chunk of its own.
import { Loader2 } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useDrawings } from "@/hooks/photos";
import { message } from "@/services/api";
import type { DrawingHandle } from "./drawing-canvas";

const Canvas = lazy(() => import("./drawing-canvas"));

type Props = {
  noteId: string;
  /** The drawing's file name to edit; null a new one. */
  name: string | null;
  open: boolean;
  onClose: () => void;
  /** A new drawing was saved: the body line that links it. */
  onCreated: (markdown: string) => void;
};

export function DrawingDialog({ noteId, name, open, onClose, onCreated }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined} showCloseButton={false} onEscapeKeyDown={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}
        className="top-0 left-0 flex h-dvh w-dvw max-w-none -translate-x-0 -translate-y-0 flex-col gap-0 rounded-none p-0 sm:max-w-none">
        <DialogTitle className="sr-only">Drawing</DialogTitle>
        <DialogDescription className="sr-only">Draw with Excalidraw, then save.</DialogDescription>
        {open ? <Editing noteId={noteId} name={name} onClose={onClose} onCreated={onCreated} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Editing({ noteId, name, onClose, onCreated }: Omit<Props, "open">) {
  const drawings = useDrawings(noteId), canvas = useRef<DrawingHandle>(null);
  const [initial, setInitial] = useState<string | null | undefined>(name ? undefined : null);   // undefined: still loading
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!name) return;
    let live = true;
    drawings.load(name).then((t) => { if (live) setInitial(t); }, (e) => { if (live) setErr(`Couldn’t open it: ${message(e)}`); });
    return () => { live = false; };
  }, [drawings, name]);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const snap = await canvas.current?.snapshot();
      if (!snap) { setErr("Draw something first."); return; }
      if (name) await drawings.save(name, snap.scene, snap.preview); else onCreated(await drawings.create(snap.scene, snap.preview));
      onClose();
    } catch (e) { setErr(`Not saved: ${message(e)}`); } finally { setBusy(false); }
  };

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="flex-1 truncate text-sm font-semibold">{name ? "Edit drawing" : "New drawing"}</span>
        {err ? <span className="truncate text-down text-xs" role="alert">{err}</span> : null}
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Close</Button>
        <Button size="sm" className="rounded-full" onClick={() => void save()} disabled={busy || initial === undefined}>
          {busy ? <Loader2 className="animate-spin" /> : null} Save
        </Button>
      </header>
      <div className="min-h-0 flex-1">
        {initial === undefined ? <p className="p-6 text-center text-faint text-sm">{err ?? "Opening…"}</p> : (
          <Suspense fallback={<p className="p-6 text-center text-faint text-sm">Loading the editor…</p>}>
            <Canvas ref={canvas} initial={initial} />
          </Suspense>
        )}
      </div>
    </>
  );
}
