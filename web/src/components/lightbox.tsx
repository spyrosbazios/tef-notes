// A note's pictures full screen, side by side in a row (Animate UI's Carousel, Embla's drop-in): a finger swipes to the next (any
// touch screen, a tablet's too), and the buttons and the arrow keys do on a laptop, where a mouse drag would fight the zoom. Click the picture: on a laptop it zooms in where
// the pointer is and moving the pointer pans it (Animate UI's Image Zoom); on a phone it shows the picture at its own size, scrolled
// by hand, and a tap fits it again. The viewer grows out of the place that was tapped. The pictures are the note's photos and its
// drawings' previews, as the editor or the read view lists them.
import useEmblaCarousel from "@animate-ui/react/primitives/carousel";
import { Image as ZoomImage, ImageZoom } from "@animate-ui/react/primitives/effects/image-zoom";
import { SlidingNumber } from "@animate-ui/react/primitives/texts/sliding-number";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useNarrow } from "@/hooks/media";
import { cn } from "@/lib/utils";

export type LightboxItem = { url: string; alt: string };

type Props = {
  items: LightboxItem[];
  /** The one showing; null closes the lightbox. */
  index: number | null;
  onIndex: (index: number | null) => void;
};

/** Where the last press was, kept for as long as it can still be what opened the viewer: it grows out of there. */
let tap: { x: number; y: number; at: number } | null = null;
addEventListener("pointerdown", (e) => { tap = { x: e.clientX, y: e.clientY, at: e.timeStamp }; }, true);
const TAP_MS = 1200;
const grownFrom = () => (tap && performance.now() - tap.at < TAP_MS ? `${tap.x}px ${tap.y}px` : undefined);

/** How far the picture zooms in under the pointer on a laptop. */
const ZOOM = 2.5;

export function Lightbox({ items, index, onIndex }: Props) {
  const at = index !== null && index < items.length ? index : null, open = at !== null;
  // What the viewer shows while it leaves: the last picture it showed, not the first
  const [shown, setShown] = useState({ items, at: at ?? 0 });
  if (at !== null && (shown.items !== items || shown.at !== at)) setShown({ items, at });
  const [origin, setOrigin] = useState<string>(), [was, setWas] = useState(open);
  if (open !== was) { setWas(open); if (open) setOrigin(grownFrom()); }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onIndex(null); }}>
      <DialogContent aria-describedby={undefined} style={{ transformOrigin: origin }}
        className="top-0 left-0 flex h-dvh w-dvw max-w-none -translate-x-0 -translate-y-0 flex-col gap-0 rounded-none bg-bg/95 p-0 ring-0 sm:max-w-none">
        <DialogTitle className="sr-only">Picture {shown.at + 1} of {shown.items.length}</DialogTitle>
        <DialogDescription className="sr-only">{shown.items[shown.at]?.alt || "Picture"}</DialogDescription>
        <Viewer items={shown.items} at={shown.at} onIndex={onIndex} />
      </DialogContent>
    </Dialog>
  );
}

function Viewer({ items, at, onIndex }: { items: LightboxItem[]; at: number; onIndex: (index: number) => void }) {
  const narrow = useNarrow();
  const [full, setFull] = useState<number | null>(null);       // phone: the picture shown at its own size, which a swipe would not page
  // Embla deep-compares its options on every render and re-initialises, which kills a glide in flight: so none of them may change
  // while the viewer is open. The first picture is the one it opened on, and the drag test is one function reading the latest `full`.
  const [start] = useState(at);
  const paging = useRef(full === null);
  useEffect(() => { paging.current = full === null; }, [full]);
  const drag = useCallback((_: unknown, e: MouseEvent | TouchEvent) => paging.current && e.type === "touchstart", []);
  const [ref, api] = useEmblaCarousel({ startIndex: start, watchDrag: drag });
  const item = items[at];

  useEffect(() => {
    if (!api) return;
    const select = () => { setFull(null); onIndex(api.selectedScrollSnap()); };
    api.on("select", select);
    return () => { api.off("select", select); };
  }, [api, onIndex]);
  useEffect(() => { if (api && api.selectedScrollSnap() !== at) api.scrollTo(at); }, [api, at]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") api?.scrollPrev();
      else if (e.key === "ArrowRight") api?.scrollNext();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [api]);

  return (
    <>
      <div ref={ref} className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full touch-pan-y touch-pinch-zoom">
          {items.map((it, i) => (
            <div key={`${i}:${it.url}`} className="h-full min-w-0 flex-[0_0_100%]" inert={i === at ? undefined : true}>
              {narrow ? <Fitted item={it} full={full === i} onFull={(on) => setFull(on ? i : null)} />
                : <div className="h-full p-4 pt-12">
                    <ImageZoom key={i === at ? "here" : "away"} aria-label={it.alt || "Picture"} zoomScale={ZOOM} zoomOnHover={false}>
                      <ZoomImage src={it.url} alt={it.alt} objectFit="contain" />
                    </ImageZoom>
                  </div>}
            </div>
          ))}
        </div>
      </div>
      <footer className="flex h-12 shrink-0 items-center justify-center gap-3 text-dim text-sm">
        <Button variant="ghost" size="icon" aria-label="Previous picture" disabled={at === 0} onClick={() => api?.scrollPrev()}><ChevronLeft /></Button>
        <span className="flex max-w-[60vw] items-center gap-2">
          {items.length > 1 ? (
            <span aria-live="polite" className="inline-flex shrink-0 items-center whitespace-pre tabular-nums">
              <SlidingNumber number={at + 1} initiallyStable />{` / ${items.length}`}
            </span>
          ) : null}
          {item?.alt ? <span className="truncate">{items.length > 1 ? "· " : ""}{item.alt}</span> : null}
        </span>
        <Button variant="ghost" size="icon" aria-label="Next picture" disabled={at >= items.length - 1} onClick={() => api?.scrollNext()}><ChevronRight /></Button>
      </footer>
    </>
  );
}

/** A phone's slide: the picture fitted to the screen, or, tapped, at its own size inside a box that scrolls. */
function Fitted({ item, full, onFull }: { item: LightboxItem; full: boolean; onFull: (on: boolean) => void }) {
  return (
    <div className={cn("flex h-full p-4 pt-12", full ? "overflow-auto" : "items-center justify-center")}>
      <img src={item.url} alt={item.alt} onClick={() => onFull(!full)}
        className={cn("m-auto", full ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain")} />
    </div>
  );
}
