import { useCallback, useEffect, useRef } from "react";
import { calm } from "@/hooks/media";

const NEAR = 80;                 // px from the end within which a reader scrolling down counts as following again
const BLOCK = 48;                // px of growth at once that is a new block (a row, a card, a message), not a streamed line

/** Whether the reader still follows the newest line, after the view moved from `was` to `top` with `gap` px left
 *  below it. Any move up is the reader leaving, however small: a touch drag starts with a few px, and a threshold
 *  there let the next streamed line pull the view back before the drag got past it. Only a move down to near the
 *  end follows again. At the very end is always following (the view is clamped there when the content shrinks). */
export function following(stuck: boolean, was: number, top: number, gap: number): boolean {
  if (gap <= 1) return true;
  if (top < was - 1) return false;
  if (top > was && gap < NEAR) return true;
  return stuck;
}

/** A scroll area that follows its newest line while that is being written, unless the reader scrolled up. A line or
 *  two of growth (streamed text) moves the view at once; a block glides there. `follow` again (a message just sent)
 *  brings it back to the end. `lines`, `state`: what changing means new lines. */
export function useStick<T extends HTMLElement>(lines: unknown, state: unknown) {
  const el = useRef<T>(null), stuck = useRef(true), height = useRef(0), top = useRef(0);
  /** Where the view is now, against where it last was: read before every move of ours, since the reader's scroll
   *  event may not have fired yet when the next line arrives. */
  const read = useCallback((e: T, tall: number) => {
    stuck.current = following(stuck.current, top.current, e.scrollTop, tall - e.scrollTop - e.clientHeight);
    top.current = e.scrollTop;
  }, []);
  useEffect(() => {
    const e = el.current;
    if (!e) return;
    const grew = e.scrollHeight - height.current;
    const first = height.current === 0;
    if (!first) read(e, Math.min(height.current, e.scrollHeight));   // the end as it was, or the shorter one a shrink clamped to
    height.current = e.scrollHeight;
    if (!stuck.current) return;
    if (first || calm() || grew <= BLOCK) {
      e.scrollTo({ top: e.scrollHeight });
      top.current = e.scrollTop;
      return;
    }
    e.scrollTo({ top: e.scrollHeight, behavior: "smooth" });   // only ever down, so never read as the reader leaving
  }, [lines, state, read]);
  const onScroll = useCallback(() => {
    const e = el.current;
    if (e) read(e, e.scrollHeight);
  }, [read]);
  const follow = useCallback(() => { stuck.current = true; }, []);
  return { el, onScroll, follow };
}
