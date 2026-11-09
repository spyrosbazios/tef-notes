// The small parts every section shares: scroll reveal, a card that lights under the pointer, the section heading,
// the brand mark, and the two device frames the drawn screens sit in.
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type RefObject } from "react";
import { MARK_PATH, MARK_VIEWBOX } from "@/core/brand";
import { themeVars, type Theme } from "@/core/theme";
import { cn } from "@/lib";
import { PHONE, Screen, WEB, type Crop, type Size } from "./mock/screen";

/** A theme's palette set as --tf-* on one element: everything inside it, written with the same classes as the rest of
 *  the page, draws in that theme. */
export const scoped = (t: Theme) => Object.fromEntries(Object.entries(themeVars(t)).map(([k, v]) => [`--tf-${k}`, v])) as CSSProperties;

/** Whether the page is at phone width (under Tailwind's `sm`), followed as the window resizes. */
export function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(max-width: 639px)").matches);
  useEffect(() => {
    const mq = matchMedia("(max-width: 639px)"), on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) { el.dataset.in = ""; io.disconnect(); }
    }, { rootMargin: "0px 0px -8% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={cn("reveal", className)} style={{ transitionDelay: `${delay}ms` }}>{children}</div>;
}

/** How far `watch`'s element has risen into the viewport, 0 (its top at the bottom edge) to 1 (its top `settle` of
 *  the way up), as a CSS variable on `ref`'s element, followed on scroll and resize without a re-render. */
function useRise(ref: RefObject<HTMLDivElement | null>, watch: RefObject<HTMLDivElement | null>, name: string, settle = 0.18) {
  useEffect(() => {
    const el = ref.current, w = watch.current;
    if (!el || !w || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const tick = () => {
      raf = 0;
      const vh = innerHeight, top = w.getBoundingClientRect().top;
      const p = Math.min(1, Math.max(0, (vh - top) / (vh * (1 - settle))));
      el.style.setProperty(name, `${p}`);
    };
    const ask = () => { if (!raf) raf = requestAnimationFrame(tick); };
    tick();
    addEventListener("scroll", ask, { passive: true });
    addEventListener("resize", ask);
    return () => { removeEventListener("scroll", ask); removeEventListener("resize", ask); cancelAnimationFrame(raf); };
  }, [ref, watch, name, settle]);
}

/** The hero's reveal: the heading lifts a little and the screen, lying back 20 degrees in perspective, stands up to
 *  flat and settles from 1.05 to 1 as it is scrolled into view (after Aceternity's container scroll animation; the
 *  phone's share is smaller: 0.7 to 0.9). Still, and flat, when the visitor asks for no motion. */
export function ScrollStage({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null), plane = useRef<HTMLDivElement>(null);
  useRise(ref, plane, "--rise");
  return (
    <div ref={ref} className={cn("stage", className)}>
      <div className="stage-title">{title}</div>
      <div ref={plane} className="stage-plane">{children}</div>
    </div>
  );
}

export function Spotlight({ children, className }: { children: ReactNode; className?: string }) {
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return <div onPointerMove={move} className={cn("spot", className)}>{children}</div>;
}

export function Heading({ eyebrow, title, children, center = true }: { eyebrow: string; title: ReactNode; children?: ReactNode; center?: boolean }) {
  return (
    <Reveal className={cn("max-w-2xl", center && "mx-auto text-center")}>
      <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-brand">{eyebrow}</p>
      <h2 className="mt-4 text-[clamp(2rem,4.6vw,3.5rem)] font-extrabold leading-[1.04] tracking-[-0.035em] text-balance">{title}</h2>
      {children ? <p className="mt-5 text-lg leading-relaxed text-dim text-pretty">{children}</p> : null}
    </Reveal>
  );
}

/** The app's mark (packages/core/src/brand.ts, the launcher's own outline), in the brand colour. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox={MARK_VIEWBOX} className={cn("text-brand", className)} fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d={MARK_PATH} />
    </svg>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <Mark className="h-6" />
      <span className="text-xl font-extrabold leading-none tracking-tight">TEF Notes</span>
    </span>
  );
}

/** Browser chrome in CSS: the traffic lights are the palette's down, warn and up. The screen is a drawn mockup
 *  (components/mock/), scaled to the frame; `label` is what a screen reader hears of it. */
export function BrowserFrame({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="img" aria-label={label} className={cn("overflow-hidden rounded-2xl border border-line bg-card shadow-lift ring-1 ring-hair", className)}>
      <div className="flex h-9 items-center gap-3 border-b border-line bg-raised/70 px-3.5 sm:h-10">
        <div className="flex gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-down/80" />
          <span className="size-2.5 rounded-full bg-warn/80" />
          <span className="size-2.5 rounded-full bg-up/80" />
        </div>
        <div className="mx-auto flex h-6 w-full max-w-72 items-center justify-center rounded-md bg-bg/70 px-3 text-[11px] text-faint">
          <span className="truncate">tefnotes.your-tailnet.ts.net</span>
        </div>
        <div className="w-10 max-sm:hidden" aria-hidden="true" />
      </div>
      <Screen size={WEB}>{children}</Screen>
    </div>
  );
}

/** One part of a screen, close up: a region of a drawn web screen (or a panel drawn on its own, at `size`) in a plain
 *  card, no browser chrome, so the eye lands on the detail and not on the device. `narrow` is a closer crop for a phone,
 *  where the whole region would scale to print too small to read. `fade` softens the edges a crop cuts through. */
export function Peek({ label, crop, narrow, size = WEB, fade, children, className }: {
  label: string; crop?: Crop; narrow?: Crop; size?: Size; fade?: "bottom" | "right" | "both"; children: ReactNode; className?: string;
}) {
  const phone = useNarrow();
  return (
    <div role="img" aria-label={label} className={cn("relative overflow-hidden rounded-2xl border border-line bg-bg shadow-lift ring-1 ring-hair", className)}>
      <Screen size={size} crop={phone && narrow ? narrow : crop}>{children}</Screen>
      {fade === "bottom" || fade === "both" ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-bg" aria-hidden="true" /> : null}
      {fade === "right" || fade === "both" ? <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-r from-transparent to-bg" aria-hidden="true" /> : null}
    </div>
  );
}

/** A phone bezel in CSS: corners proportional to the frame (so they clip the same share of the screen at any size), camera hole, the drawn screen inside it. `className` places the frame (width, position). */
export function PhoneFrame({ label, children, className, style }: { label: string; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div role="img" aria-label={label} style={style} className={className}>
      <div className="relative rounded-[14%/6.2%] border border-line bg-raised p-[5px] shadow-lift ring-1 ring-hair sm:p-[6px]">
        <div className="relative overflow-hidden rounded-[12.5%/5.5%] bg-bg">
          <Screen size={PHONE}>{children}</Screen>
          <span className="absolute left-1/2 top-[2.2%] size-[4.5%] -translate-x-1/2 rounded-full bg-bg ring-1 ring-hair" aria-hidden="true" />
        </div>
        <span className="absolute -right-[3px] top-[20%] h-[9%] w-[3px] rounded-r bg-line" aria-hidden="true" />
        <span className="absolute -right-[3px] top-[32%] h-[5%] w-[3px] rounded-r bg-line" aria-hidden="true" />
      </div>
    </div>
  );
}
