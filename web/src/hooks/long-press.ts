// A long press, the touch screen's right-click: hold a finger (or pen) still for half a second and `onLong` is called with
// where it is. Moving away, lifting early or a scroll starting cancels it. The click that follows the lift is swallowed, so
// holding a tile doesn't also open it. A mouse never long-presses: its right-click is the `contextmenu` event.
// `menu`: the element's own context menu is the same action, so a `contextmenu` event (a mouse's right-click, and what Android
// sends itself on a long press) calls `onLong` too, once per hold; without it the event is only kept from showing the browser's menu for a touch.
import { useEffect, useRef, type MouseEvent, type PointerEvent } from "react";

const HOLD = 500;   // ms
const SLOP = 10;    // px a finger may drift and still be holding

type At = { x: number; y: number };

export function useLongPress(onLong: (at: At) => void, { menu = false }: { menu?: boolean } = {}) {
  const latest = useRef(onLong);
  useEffect(() => { latest.current = onLong; });
  const hold = useRef<{ x: number; y: number; timer: number } | null>(null);
  const fired = useRef(false);        // the hold completed: the click after the lift is not a tap
  const touched = useRef(false);      // the last press was a finger or pen

  const cancel = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  };
  useEffect(() => cancel, []);

  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      touched.current = e.pointerType !== "mouse";
      fired.current = false;
      cancel();
      // A portal's events bubble through React to the element it was rendered under: only a press on the element itself counts
      if (!touched.current || !e.isPrimary || !e.currentTarget.contains(e.target as Node)) return;
      const at = { x: e.clientX, y: e.clientY };
      hold.current = { ...at, timer: window.setTimeout(() => { hold.current = null; fired.current = true; latest.current(at); }, HOLD) };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (hold.current && Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > SLOP) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture: (e: MouseEvent<HTMLElement>) => {
      if (!fired.current) return;
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
    onContextMenu: (e: MouseEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.target as Node) || (!menu && !touched.current)) return;
      e.preventDefault();
      if (!menu || fired.current) return;
      // Android sends this itself at about the time the hold completes, either side of it: whichever comes first acts and the
      // other doesn't. For a finger the click after the lift is then swallowed too; a mouse's right-click has none to swallow.
      cancel();
      fired.current = touched.current;
      latest.current({ x: e.clientX, y: e.clientY });
    },
  };
}
