// A media query as state (changes with the window, a rotation or a keyboard dock). The phone-width layout is `< md`
// (Tailwind's 768px), the same line the CSS classes `max-md:` and `md:` draw.
import { useSyncExternalStore } from "react";

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia(query); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => matchMedia(query).matches,
  );
}

/** The window is narrower than `md`: panes become sheets and pages take turns. */
export const useNarrow = () => useMedia("(max-width: 767px)");

/** A finger is among the pointers (a phone, a tablet, a laptop with a touch screen): the switch of the touch pass, the same query as
 *  the CSS variant `any-pointer-coarse:` (index.css). The main pointer alone would miss a mouse and a screen on one machine. */
const TOUCH = "(any-pointer: coarse)";
export const touching = (): boolean => matchMedia(TOUCH).matches;
export const useTouch = () => useMedia(TOUCH);
