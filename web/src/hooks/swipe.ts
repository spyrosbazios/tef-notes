// A row swiped with a finger, as the phone's task rows are (lib/swipe.ts has the geometry): to the right asks `onWhen` and the
// row snaps back, to the left leaves the Delete button out until it is tapped or anything else is touched. Touch and pen
// only: a mouse never swipes (it has the hover buttons and the context menu). The row's `touch-action` must be `pan-y`, so the
// page still scrolls under a vertical drag and only a sideways one comes here; a press on the row's drag handle
// (`data-drag-handle`, hooks/drag.ts) or on anything marked `data-swipe-skip` is not a swipe. The click that ends a swipe is
// swallowed, so letting go over the title doesn't open the task.
import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { CLAIM, DELETE_WIDTH, offsetOf, outcomeOf } from "@/lib/swipe";

type Gesture = { pointer: number; x0: number; y0: number; claimed: boolean };

/** `when`: a swipe to the right is allowed. `onWhen`: asked for on one. */
export function useSwipe({ when, onWhen }: { when: boolean; onWhen: () => void }) {
  const [x, setX] = useState(0);
  const [live, setLive] = useState(false);
  const at = useRef(0);                                  // where the row rests: 0, or -DELETE_WIDTH with Delete out
  const now = useRef(0);                                 // where it is while a finger has it
  const g = useRef<Gesture | null>(null);
  const swallow = useRef(false);
  const ask = useRef(onWhen);
  useEffect(() => { ask.current = onWhen; });

  const rest = useCallback((to: number) => { at.current = to; now.current = to; setX(to); }, []);
  const close = useCallback(() => rest(0), [rest]);
  const out = x === -DELETE_WIDTH && !live;

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
    ref: (el: HTMLElement | null) => { row.current = el; },
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      swallow.current = false;
      const t = e.target as Element;
      // A portal's press (a sheet over the row) bubbles here through React
      if (e.pointerType === "mouse" || !e.isPrimary || !e.currentTarget.contains(t) || t.closest("[data-drag-handle],[data-swipe-skip]")) return;
      g.current = { pointer: e.pointerId, x0: e.clientX, y0: e.clientY, claimed: false };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const s = g.current;
      if (!s || e.pointerId !== s.pointer) return;
      const dx = e.clientX - s.x0, dy = e.clientY - s.y0;
      if (!s.claimed) {
        if (Math.abs(dy) > CLAIM && Math.abs(dy) > Math.abs(dx)) { g.current = null; return; }     // the page is scrolling
        if (Math.abs(dx) <= CLAIM || Math.abs(dx) < Math.abs(dy)) return;
        s.claimed = true; s.x0 = e.clientX;
        e.currentTarget.setPointerCapture(e.pointerId);
        setLive(true);
        return;
      }
      now.current = offsetOf(e.clientX - s.x0, at.current, when);
      setX(now.current);
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
      setLive(false);
      const o = outcomeOf(now.current);
      if (o === "delete") { rest(-DELETE_WIDTH); navigator.vibrate?.(8); }
      else { close(); if (o === "when") { navigator.vibrate?.(8); ask.current(); } }
    },
    onPointerCancel: (e: PointerEvent<HTMLElement>) => {
      if (g.current?.pointer !== e.pointerId) return;
      const claimed = g.current.claimed;
      g.current = null;
      if (claimed) { setLive(false); rest(at.current); }
    },
    onClickCapture: (e: MouseEvent<HTMLElement>) => {
      if (!swallow.current) return;
      swallow.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
  return { x, live, props, close };
}
