// A note's PDF read in the app: pdf.js (src/pdf/pages.ts, the same the phone's viewer page runs) in a dialog, the pages one
// under another, a counter that jumps to a page, zoom buttons. In a window and not the browser's own viewer because the
// server serves attachments under a CSP sandbox, which Chrome's viewer can't open. pdf.js is a chunk of its own,
// loaded when the first PDF opens.
import { Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useNarrow } from "@/hooks/media";
import { message } from "@/services/api";
import type { PdfPages } from "@/pdf/pages";

const STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/** `url`: the file on the server; `name`: what the header says. Null `url` is closed. */
export function PdfViewer({ url, name, onClose }: { url: string | null; name: string; onClose: () => void }) {
  const narrow = useNarrow();
  return (
    <Dialog open={url !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined} data-side={narrow ? "bottom" : undefined} className="flex h-[92dvh] w-[min(56rem,96vw)] max-w-none flex-col gap-0 p-0 sm:max-w-none">
        <DialogTitle className="truncate border-b border-line py-3 pr-12 pl-4 text-sm font-semibold">{name}</DialogTitle>
        <DialogDescription className="sr-only">The PDF, page by page</DialogDescription>
        {url ? <Pages url={url} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Pages({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null), pdf = useRef<PdfPages | null>(null);
  const [zoom, setZoom] = useState(2), [state, setState] = useState<"loading" | "shown" | "failed">("loading");
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      const [{ showPdf }, res] = await Promise.all([import("@/pdf/pages"), fetch(url)]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!live) return;
      const shown = await showPdf(host.current!, bytes, () => { if (live) setState("shown"); });
      if (live) pdf.current = shown; else shown.destroy();
    })().catch((e) => { if (live) { setState("failed"); setErr(message(e)); } });
    return () => { live = false; pdf.current?.destroy(); pdf.current = null; };
  }, [url]);

  const step = (d: number) => {
    const next = Math.min(Math.max(zoom + d, 0), STEPS.length - 1);
    setZoom(next);
    pdf.current?.zoom(STEPS[next]);
  };

  return (
    <>
      <div className="relative min-h-0 flex-1 overflow-auto p-3">
        {state === "loading" ? <p className="p-6 text-center text-faint text-sm">Opening…</p> : null}
        {state === "failed" ? <p className="p-6 text-center text-down text-sm">Couldn’t open it: {err}</p> : null}
        <div ref={host} />
      </div>
      <footer className="flex h-12 shrink-0 items-center justify-center gap-2 border-t border-line text-dim text-sm">
        <Button variant="ghost" size="icon" aria-label="Zoom out" disabled={zoom === 0} onClick={() => step(-1)}><Minus /></Button>
        <span className="w-12 text-center tabular-nums">{Math.round(STEPS[zoom] * 100)}%</span>
        <Button variant="ghost" size="icon" aria-label="Zoom in" disabled={zoom === STEPS.length - 1} onClick={() => step(1)}><Plus /></Button>
      </footer>
    </>
  );
}
