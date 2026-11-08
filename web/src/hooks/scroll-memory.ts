// A scroller that comes back where it was left: its place is kept per `key` (lib/scroll-memory.ts) as it scrolls, and put back when
// the scroller mounts, its key changes or it is shown again (`active`). Tiles measure and pictures land after the first paint, so
// the place is re-applied on every frame until the owner touches the list or SETTLE_MS passes. Instant, never a glide.
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { keepScroll, scrollOf, SETTLE_MS } from "@/lib/scroll-memory";

/** What hands the list back to the owner before a restore has finished. */
const TAKEN = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

export function useScrollMemory<T extends HTMLElement>(key: string, active = true): RefObject<T | null> {
  const ref = useRef<T>(null);
  const restoring = useRef(false);   // the scroll events of a restore are not the owner's: they must not overwrite the place being restored

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const want = scrollOf(key);
    el.scrollTo({ top: want, behavior: "instant" });
    if (want <= 0) return;
    restoring.current = true;
    let raf = 0;
    const until = performance.now() + SETTLE_MS;
    const frame = () => {
      if (performance.now() > until) { done(); return; }
      if (Math.abs(el.scrollTop - want) >= 1) el.scrollTo({ top: want, behavior: "instant" });
      raf = requestAnimationFrame(frame);
    };
    const done = () => {
      restoring.current = false;
      cancelAnimationFrame(raf);
      for (const t of TAKEN) el.removeEventListener(t, done);
    };
    for (const t of TAKEN) el.addEventListener(t, done, { passive: true });
    raf = requestAnimationFrame(frame);
    return done;
  }, [key, active]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const saw = () => { if (!restoring.current && el.offsetParent !== null) keepScroll(key, el.scrollTop); };
    el.addEventListener("scroll", saw, { passive: true });
    return () => el.removeEventListener("scroll", saw);
  }, [key, active]);

  return ref;
}
