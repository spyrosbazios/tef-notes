// Dragging a list row to a new place with pointer events, one path for mouse and touch: no dependency, and none of the
// browser's own drag and drop (which a finger never starts). A mouse press that moves a few pixels lifts the row; a finger
// lifts it by holding still for `HOLD` ms (a finger that moves first is scrolling or swiping), and from then on the page is
// kept from scrolling under it. The long press's context menu waits: it opens only if the finger lets go without moving. The
// lifted row it follows the pointer's place among the rows (`data-drag-id`) of its own `group` (a section of the list, so
// a drag never crosses one), scrolls the list when held at its edge, and lands where the pointer lets go. Escape or a
// cancelled pointer drops it where it was. The hook holds which row is up and which side of which row it is over; the list says
// what a drop means.
import { haptic } from "@/lib/haptics";
import { useEffect, useRef, useState, type HTMLAttributes, type PointerEvent } from "react";

export type RowDrag = {
  /** Spread on the row's element. */
  props: Pick<HTMLAttributes<HTMLElement>, "onPointerDown"> & { "data-drag-group": string; "data-drag-id": string };
  /** This row is the one picked up. */
  dragging: boolean;
  /** The drop would land on this side of this row. */
  mark: "before" | "after" | null;
};

type Held = { id: string; group: string };
type Over = { id: string; after: boolean };
/** One press, from its pointer going down to it ending. */
type Press = { id: string; group: string; pointer: number; x: number; y: number; lifted: boolean; moved: boolean; over: Over | null; list: HTMLElement | null; frame: number; stop: () => void };

const SLOP = 6;       // px a press moves before it is a drag
const EDGE = 56;      // px from the list's edge where holding scrolls it
const SPEED = 16;     // px per frame at the very edge
const HOLD = 400;     // ms a finger holds still before the row lifts

/** The nearest ancestor that scrolls. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** `onMove(group, id, over, after)`: row `id` was dropped before (or `after`) the row `over`, both in `group`. */
export function useRowDrag(onMove: (group: string, id: string, over: string, after: boolean) => void): (group: string, id: string) => RowDrag {
  const [held, setHeld] = useState<Held | null>(null);
  const [over, setOver] = useState<Over | null>(null);
  const press = useRef<Press | null>(null);
  const move = useRef(onMove);
  useEffect(() => { move.current = onMove; });
  useEffect(() => () => press.current?.stop(), []);

  const begin = (e: PointerEvent<HTMLElement>, group: string, id: string) => {
    const p: Press = { id, group, pointer: e.pointerId, x: e.clientX, y: e.clientY, lifted: false, moved: false, over: null, list: null, frame: 0, stop: () => {} };
    const row = e.currentTarget;
    const touch = e.pointerType !== "mouse";
    const x0 = e.clientX, y0 = e.clientY;
    press.current = p;

    /** Where the pointer is among the group's rows. */
    const locate = () => {
      const at = document.elementFromPoint(p.x, p.y)?.closest<HTMLElement>("[data-drag-id]");
      let next: Over | null = null;
      if (at && at.dataset.dragGroup === group && at.dataset.dragId !== id) {
        const r = at.getBoundingClientRect();
        next = { id: at.dataset.dragId!, after: p.y > r.top + r.height / 2 };
      }
      if (next?.id !== p.over?.id || next?.after !== p.over?.after) { p.over = next; setOver(next); }
    };
    const tick = () => {
      if (p.list) {
        const r = p.list.getBoundingClientRect();
        const by = p.y < r.top + EDGE ? -(1 - Math.max(0, p.y - r.top) / EDGE) : p.y > r.bottom - EDGE ? 1 - Math.max(0, r.bottom - p.y) / EDGE : 0;
        if (by) { p.list.scrollTop += Math.round(by * SPEED); locate(); }
      }
      p.frame = requestAnimationFrame(tick);
    };
    const noSelect = (ev: Event) => ev.preventDefault();
    const lift = () => {
      p.lifted = true;
      p.list = scrollerOf(row);
      setHeld({ id, group });
      getSelection()?.removeAllRanges();
      document.body.style.cursor = "grabbing";
      document.body.dataset.rowDrag = "";                                   // hooks/swipe.ts lets go of the row
      if (touch) haptic("tick");
      p.frame = requestAnimationFrame(tick);
    };
    const hold = touch ? setTimeout(lift, HOLD) : 0;
    let menu: MouseEvent | null = null;                                     // the long press's context menu, held back
    const onMenu = (ev: MouseEvent) => { ev.preventDefault(); ev.stopPropagation(); menu = ev; };
    const noScroll = (ev: TouchEvent) => { if (p.lifted && ev.cancelable) ev.preventDefault(); };
    const onMovePointer = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== p.pointer) return;
      p.x = ev.clientX; p.y = ev.clientY;
      if (Math.hypot(p.x - x0, p.y - y0) < SLOP) return;
      p.moved = true;
      if (!p.lifted) {
        if (touch) { p.stop(); return; }                                    // a finger moved before the hold: not a drag
        lift();
      }
      locate();
    };
    const finish = (drop: boolean) => {
      const landed = drop && p.lifted ? p.over : null;
      const still = drop && touch && !p.moved ? menu : null;
      p.stop();
      if (landed) move.current(group, id, landed.id, landed.after);
      if (still) row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: still.clientX, clientY: still.clientY }));
    };
    const onUp = (ev: globalThis.PointerEvent) => { if (ev.pointerId === p.pointer) finish(ev.type === "pointerup"); };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") finish(false); };
    // What the lifted press leaves behind is not a tap: the click after the lift is swallowed, as is a selection starting
    const swallow = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
    p.stop = () => {
      cancelAnimationFrame(p.frame);
      clearTimeout(hold);
      removeEventListener("contextmenu", onMenu, { capture: true });
      removeEventListener("touchmove", noScroll);
      delete document.body.dataset.rowDrag;
      removeEventListener("pointermove", onMovePointer);
      removeEventListener("pointerup", onUp);
      removeEventListener("pointercancel", onUp);
      removeEventListener("keydown", onKey);
      document.removeEventListener("selectstart", noSelect);
      document.body.style.cursor = "";
      if (p.lifted) {
        addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => removeEventListener("click", swallow, { capture: true }), 0);
      }
      if (press.current === p) press.current = null;
      setHeld(null);
      setOver(null);
    };
    addEventListener("pointermove", onMovePointer);
    addEventListener("pointerup", onUp);
    addEventListener("pointercancel", onUp);
    addEventListener("keydown", onKey);
    if (touch) { addEventListener("contextmenu", onMenu, { capture: true }); addEventListener("touchmove", noScroll, { passive: false }); }
    document.addEventListener("selectstart", noSelect);
  };

  return (group, id) => ({
    dragging: held?.id === id,
    mark: held?.group === group && over?.id === id ? (over.after ? "after" : "before") : null,
    props: {
      "data-drag-group": group,
      "data-drag-id": id,
      onPointerDown: (e) => {
        if (e.button !== 0 || !e.isPrimary) return;
        press.current?.stop();                                              // one whose pointerup was lost (let go outside the window)
        const target = e.target as Element;
        if (!e.currentTarget.contains(target)) return;                      // a portal's press (the row's menu) bubbles here through React
        begin(e, group, id);
      },
    },
  });
}
