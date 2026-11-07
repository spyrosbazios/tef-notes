// A note's pictures full screen: one at a time, fitted to the window, with previous and next (buttons, arrow keys) and
// the caption under it. Click the picture to see it at its own size, scrolling; click again to fit it. The pictures are
// the note's photos and its drawings' previews, as the editor or the read view lists them.
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type LightboxItem = { url: string; alt: string };

type Props = {
  items: LightboxItem[];
  /** The one showing; null closes the lightbox. */
  index: number | null;
  onIndex: (index: number | null) => void;
};

export function Lightbox({ items, index, onIndex }: Props) {
  const [seen, setSeen] = useState<{ at: number; full: boolean }>({ at: 0, full: false });
  const open = index !== null && index < items.length;
  const at = open ? index : 0, item = items[at];

  const full = seen.at === at && seen.full;                // a picture is fitted until clicked, each time it comes up
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && at > 0) onIndex(at - 1);
      else if (e.key === "ArrowRight" && at < items.length - 1) onIndex(at + 1);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [open, at, items.length, onIndex]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setSeen({ at: 0, full: false }); onIndex(null); } }}>
      <DialogContent aria-describedby={undefined}
        className="top-0 left-0 flex h-dvh w-dvw max-w-none -translate-x-0 -translate-y-0 flex-col gap-0 rounded-none bg-bg/95 p-0 ring-0 sm:max-w-none">
        <DialogTitle className="sr-only">Picture {at + 1} of {items.length}</DialogTitle>
        <DialogDescription className="sr-only">{item?.alt || "Picture"}</DialogDescription>
        <div className={cn("flex min-h-0 flex-1 p-4 pt-12", full ? "overflow-auto" : "items-center justify-center")}>
          {item ? (
            <img src={item.url} alt={item.alt} onClick={() => setSeen({ at, full: !full })}
              className={cn("m-auto rounded-lg", full ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain")} />
          ) : null}
        </div>
        <footer className="flex h-12 shrink-0 items-center justify-center gap-3 text-dim text-sm">
          <Button variant="ghost" size="icon" aria-label="Previous picture" disabled={at === 0} onClick={() => onIndex(at - 1)}><ChevronLeft /></Button>
          <span className="max-w-[60vw] truncate tabular-nums">{items.length > 1 ? `${at + 1} / ${items.length}` : ""}{item?.alt ? `${items.length > 1 ? "  ·  " : ""}${item.alt}` : ""}</span>
          <Button variant="ghost" size="icon" aria-label="Next picture" disabled={at >= items.length - 1} onClick={() => onIndex(at + 1)}><ChevronRight /></Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
