// A mockup is drawn at one fixed design size (1440 wide for the web app, 390 for the phone) and scaled with a CSS
// transform to whatever width its frame has: the composition, its line breaks and its crisp text are the same at every
// breakpoint, and the frame keeps the design's aspect ratio so the page never jumps. A `crop` shows one region of the
// design instead of the whole: the region fills the frame, so a detail reads at a size a whole screen never could.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib";

export const WEB = { w: 1440, h: 900 } as const;
export const PHONE = { w: 390, h: 875 } as const;

export type Size = { w: number; h: number };
/** A region of a design, in its pixels. */
export type Crop = { x: number; y: number; w: number; h: number };

/** The scale that fits a design `width` into the element behind `ref`, followed as it resizes. */
export function useScale(width: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / width);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return [ref, scale] as const;
}

/** The screen's box: fills its frame's width at the design's (or the crop's) ratio and holds the mockup at its design
 *  size, scaled and, for a crop, shifted so the region sits at the top left. */
export function Screen({ size, crop, children, className }: { size: Size; crop?: Crop; children: ReactNode; className?: string }) {
  const box = crop ?? { x: 0, y: 0, ...size };
  const [ref, scale] = useScale(box.w);
  return (
    <div ref={ref} aria-hidden="true" className={cn("relative w-full overflow-hidden bg-bg", className)} style={{ aspectRatio: `${box.w} / ${box.h}` }}>
      <div className="pointer-events-none absolute left-0 top-0 origin-top-left select-none overflow-hidden text-sm leading-normal text-fg"
        style={{ width: size.w, height: size.h, transform: `scale(${scale}) translate(${-box.x}px, ${-box.y}px)` }}>
        {children}
      </div>
    </div>
  );
}
