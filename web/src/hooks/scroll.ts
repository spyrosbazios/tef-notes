// A scroller's place when what it shows changes without a navigation: a lens switched on Home, a list picked in Home's task box.
// The router puts a scroller back at each navigation (router.ts, lib/scroll.ts), but it saves places only as a navigation starts, so
// the list a switch leaves would have none to come back to. This keeps the place of each id as the scroller moves (until the page is
// closed; a reload finds the router's saved ones) and puts it back when the id changes under the scroller.
import { useElementScrollRestoration } from "@tanstack/react-router";
import { useLayoutEffect, useRef, type RefObject } from "react";
import { SCROLL_KEY } from "@/lib/scroll";

const places = new Map<string, number>();

/** How long a restored place is held while the new list settles (its old tiles leaving and the new ones measuring shorten and
 *  lengthen the page, and the browser clamps the scroll to the shortest). */
const SETTLE = 1000;
const HANDS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/** Where the scroller `id` was left: as it was last seen to move, else as the router saved it (a reload keeps those), else the top. */
export function useSavedScroll(id: string): number {
  const saved = useElementScrollRestoration({ id, getKey: () => SCROLL_KEY });
  return places.get(id) ?? saved?.scrollY ?? 0;
}

/** Keeps the place of `scroller` under its `id`, and puts the place of the next `id` back when it changes (the top for one never seen).
 *  The first id is the router's to restore. The new place is held, put back as the page resizes, until a hand moves the list or
 *  `SETTLE` is over (it may be reached before the page has its final height); what moves the scroll meanwhile is not the owner's and is not kept as a place. */
export function useScrollSwitch(scroller: RefObject<HTMLElement | null>, id: string): void {
  const place = useSavedScroll(id), shown = useRef(id), holding = useRef(false);
  // Layout effects, so the listener changes ids in the commit that changes the page: a scroll event of the new place is never the old id's
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const note = () => { if (!holding.current) places.set(id, el.scrollTop); };
    el.addEventListener("scroll", note, { passive: true });
    return () => el.removeEventListener("scroll", note);
  }, [scroller, id]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || shown.current === id) return;
    shown.current = id;
    holding.current = true;
    const put = () => el.scrollTo({ top: place, behavior: "instant" });
    const ro = new ResizeObserver(put);
    const timer = setTimeout(() => release(), SETTLE);
    function release() {
      holding.current = false;
      ro.disconnect();
      clearTimeout(timer);
      for (const h of HANDS) el!.removeEventListener(h, release);
    }
    for (const h of HANDS) el.addEventListener(h, release, { passive: true, once: true });
    for (const c of el.children) ro.observe(c);
    put();
    return release;
  }, [scroller, id, place]);
}
