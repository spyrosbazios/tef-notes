// A row swiped with a finger, as the phone's task rows are (lib/swipe.ts has the geometry): to the right asks `onWhen` and the
// row snaps back, to the left leaves the Delete button out until it is tapped or anything else is touched. Touch and pen
// only: a mouse never swipes (it has the hover buttons and the context menu). The row's `touch-action` must be `pan-y`, so the
// page still scrolls under a vertical drag and only a sideways one comes here; a press on the row's drag handle
// (`data-drag-handle`, hooks/drag.ts) or on anything marked `data-swipe-skip` is not a swipe. The click that ends a swipe is
// swallowed, so letting go over the title doesn't open the task.
// The row's offset is a motion value, not React state: a finger moves it with no render, and letting go eases it to where it
// rests on `spring.slide` (a press that grabs it mid-glide takes over from where it is). `side` is the one thing that does
// render: which action the row has uncovered, so the layer behind it is there while it shows.
import { spring, useTempoTransition } from "@animate-ui/react/utils/motion";
import { animate, useMotionValue, useMotionValueEvent, type AnimationPlaybackControls } from "motion/react";
import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { CLAIM, DELETE_WIDTH, offsetOf, outcomeOf } from "@/lib/swipe";
import { calm } from "./media";

/** `from`: where the row was when the finger took it (its rest, or mid-glide). */
type Gesture = { pointer: number; x0: number; y0: number; claimed: boolean; from: number };
export type Side = "when" | "delete" | null;

/** `when`: a swipe to the right is allowed. `onWhen`: asked for on one. */
export function useSwipe({ when, onWhen }: { when: boolean; onWhen: () => void }) {
  const x = useMotionValue(0);
  const [side, setSide] = useState<Side>(null);
  const [out, setOut] = useState(false);                     // Delete is out and at rest
  const at = useRef(0);                                  // where the row rests: 0, or -DELETE_WIDTH with Delete out
  const now = useRef(0);                                 // where it is while a finger has it
  const g = useRef<Gesture | null>(null);
  const swallow = useRef(false);
  const glide = useRef<AnimationPlaybackControls | null>(null);
  const ask = useRef(onWhen);
  const slide = useTempoTransition(spring.slide);
  const glideOn = useRef(slide);
  useEffect(() => { ask.current = onWhen; glideOn.current = slide; });
  useEffect(() => () => glide.current?.stop(), []);
  useMotionValueEvent(x, "change", (v) => setSide(v > 0 ? "when" : v < 0 ? "delete" : null));

  const rest = useCallback((to: number) => {
    at.current = to; now.current = to; setOut(to === -DELETE_WIDTH);
    glide.current?.stop();
    if (calm()) x.set(to); else glide.current = animate(x, to, glideOn.current);
  }, [x]);
  const close = useCallback(() => rest(0), [rest]);

  // With Delete out, a touch anywhere but on it puts the row back
  const row = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!out) return;
    const f = (e: globalThis.PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest("[data-swipe-skip]") || row.current?.contains(t)) return;
      close();
    };
    addEventListener("pointerdown", f, true);
    return () => removeEventListener("pointerdown", f, true);
  }, [out, close]);

  const props = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      swallow.current = false;
      row.current = e.currentTarget;
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
        setOut(false);
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
      if (!s.claimed) {
        // A tap on the row while Delete is out only puts it back
        if (at.current !== 0) { swallow.current = true; close(); }
        return;
      }
      swallow.current = true;
      const o = outcomeOf(now.current);
      if (o === "delete") { rest(-DELETE_WIDTH); navigator.vibrate?.(8); }
      else { close(); if (o === "when") { navigator.vibrate?.(8); ask.current(); } }
    },
    onPointerCancel: (e: PointerEvent<HTMLElement>) => {
      if (g.current?.pointer !== e.pointerId) return;
      const claimed = g.current.claimed;
      g.current = null;
      if (claimed) rest(at.current);
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
