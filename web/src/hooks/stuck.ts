// Whether a sticky element is stuck: a sentinel laid just before it has scrolled above the top of its scroller. The sentinel
// below the scroller's bottom (not reached yet) is not stuck either: only above counts.
import { useEffect, useState, type RefObject } from "react";

export function useStuck(sentinel: RefObject<HTMLElement | null>): boolean {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    let root: HTMLElement | null = el.parentElement;
    while (root && !/auto|scroll/.test(getComputedStyle(root).overflowY)) root = root.parentElement;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top < (e.rootBounds?.top ?? 0)), { root, threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [sentinel]);
  return stuck;
}
