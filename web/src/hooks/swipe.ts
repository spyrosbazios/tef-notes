// A row swiped with a finger, as the phone's task rows are (lib/swipe.ts has the geometry): to the right asks `onWhen`, to the
// left asks `onDelete` (no button to tap after: the list's take-back banner confirms), and the row snaps back. Touch and pen
// only: a mouse never swipes (it has the hover buttons and the context menu). The row's `touch-action` must be `pan-y`, so the
// page still scrolls under a vertical drag and only a sideways one comes here; a press on the row's drag handle
// (`data-drag-handle`, hooks/drag.ts) or on anything marked `data-swipe-skip` is not a swipe. The click that ends a swipe is
// swallowed, so letting go over the title doesn't open the task.
// The row's offset is a motion value, not React state: a finger moves it with no render, and letting go eases it to where it
// rests (0) on `spring.slide` (a press that grabs it mid-glide takes over from where it is). `side` is the one thing that does
// render: which action the row has uncovered, so the layer behind it is there while it shows.
import { spring, useTempoTransition } from "@animate-ui/react/utils/motion";
import { animate, useMotionValue, useMotionValueEvent, type AnimationPlaybackControls } from "motion/react";
import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { CLAIM, offsetOf, outcomeOf } from "@/lib/swipe";
import { calm } from "./media";

/** `from`: where the row was when the finger took it (its rest, or mid-glide). */
type Gesture = { pointer: number; x0: number; y0: number; claimed: boolean; from: number };
export type Side = "when" | "delete" | null;

/** `when`: a swipe to the right is allowed. `onWhen`, `onDelete`: asked for on a swipe right, left. */
export function useSwipe({ when, onWhen, onDelete }: { when: boolean; onWhen: () => void; onDelete: () => void }) {
  const x = useMotionValue(0);
  const [side, setSide] = useState<Side>(null);
  const now = useRef(0);                                 // where it is while a finger has it
  const g = useRef<Gesture | null>(null);
  const swallow = useRef(false);
  const glide = useRef<AnimationPlaybackControls | null>(null);
  const ask = useRef({ onWhen, onDelete });
  const slide = useTempoTransition(spring.slide);
  const glideOn = useRef(slide);
  useEffect(() => { ask.current = { onWhen, onDelete }; glideOn.current = slide; });
  useEffect(() => () => glide.current?.stop(), []);
  useMotionValueEvent(x, "change", (v) => setSide(v > 0 ? "when" : v < 0 ? "delete" : null));

  const close = useCallback(() => {
    now.current = 0;
    glide.current?.stop();
    if (calm()) x.set(0); else glide.current = animate(x, 0, glideOn.current);
  }, [x]);

  const props = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      swallow.current = false;
      const t = e.target as Element;
      // A portal's press (a sheet over the row) bubbles here through React
      if (e.pointerType === "mouse" || !e.isPrimary || !e.currentTarget.contains(t) || t.closest("[data-drag-handle],[data-swipe-skip]")) return;
      g.current = { pointer: e.pointerId, x0: e.clientX, y0: e.clientY, claimed: false, from: x.get() };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const s = g.current;
      if (!s || e.pointerId !== s.pointer) return;
      const dx = e.clientX - s.x0, dy = e.clientY - s.y0;
      if (!s.claimed) {
        if (Math.abs(dy) > CLAIM && Math.abs(dy) > Math.abs(dx)) { g.current = null; return; }     // the page is scrolling
        if (Math.abs(dx) <= CLAIM || Math.abs(dx) < Math.abs(dy)) return;
        s.claimed = true; s.x0 = e.clientX; s.from = now.current = x.get();
        glide.current?.stop();
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      now.current = offsetOf(e.clientX - s.x0, s.from, when);
      x.set(now.current);
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const s = g.current;
      if (!s || e.pointerId !== s.pointer) return;
      g.current = null;
      if (!s.claimed) return;
      swallow.current = true;
      const o = outcomeOf(now.current);
      close();
      if (o === "closed") return;
      navigator.vibrate?.(8);
      if (o === "when") ask.current.onWhen(); else ask.current.onDelete();
    },
    onPointerCancel: (e: PointerEvent<HTMLElement>) => {
      if (g.current?.pointer !== e.pointerId) return;
      const claimed = g.current.claimed;
      g.current = null;
      if (claimed) close();
    },
    onClickCapture: (e: MouseEvent<HTMLElement>) => {
      if (!swallow.current) return;
      swallow.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
  return { x, side, props, close };
}
