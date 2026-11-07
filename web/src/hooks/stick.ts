import { useCallback, useEffect, useRef } from "react";

const NEAR = 80;                 // px from the end within which the reader counts as still following
const BLOCK = 48;                // px of growth at once that is a new block (a row, a card, a message), not a streamed line
const GLIDE = 350;               // ms a smooth scroll to the end is given before its own scroll events count again

/** A scroll area that follows its newest line while that is being written, unless the reader scrolled up. A line or
 *  two of growth (streamed text) moves the view at once; a block glides there, and its own scroll events are not the
 *  reader leaving — a wheel or a touch is. `follow` again (a message just sent) brings it back to the end. `lines`,
 *  `state`: what changing means new lines. */
export function useStick<T extends HTMLElement>(lines: unknown, state: unknown) {
  const el = useRef<T>(null), stuck = useRef(true), gliding = useRef(false), height = useRef(0);
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const e = el.current;
    if (!e) return;
    const grew = e.scrollHeight - height.current;
    const first = height.current === 0;
    height.current = e.scrollHeight;
    if (!stuck.current) return;
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (first || calm || grew <= BLOCK) { e.scrollTo({ top: e.scrollHeight }); return; }
    gliding.current = true;
    clearTimeout(settle.current);
    settle.current = setTimeout(() => { gliding.current = false; }, GLIDE);
    e.scrollTo({ top: e.scrollHeight, behavior: "smooth" });
  }, [lines, state]);
  useEffect(() => {
    const e = el.current, stop = () => { gliding.current = false; };
    e?.addEventListener("wheel", stop, { passive: true });
    e?.addEventListener("touchstart", stop, { passive: true });
    return () => { e?.removeEventListener("wheel", stop); e?.removeEventListener("touchstart", stop); clearTimeout(settle.current); };
  }, []);
  const onScroll = useCallback(() => {
    const e = el.current;
    if (e && !gliding.current) stuck.current = e.scrollHeight - e.scrollTop - e.clientHeight < NEAR;
  }, []);
  const follow = useCallback(() => { stuck.current = true; }, []);
  return { el, onScroll, follow };
}
