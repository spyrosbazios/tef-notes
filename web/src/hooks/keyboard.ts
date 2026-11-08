// Whether the on-screen keyboard is up, for what hides under it (the phone's tab bar, components/tab-bar.tsx).
import { useEffect, useState } from "react";
import { touching } from "./media";

/** How much shorter than its full height the visual viewport must be to count as the keyboard: a Chrome Android URL
 *  bar that shows or hides moves it by less. */
const KEYBOARD_MIN = 120;

const field = (t: EventTarget | null): t is HTMLElement => t instanceof HTMLElement && (t.isContentEditable || t instanceof HTMLTextAreaElement
  || (t instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "range", "file", "color"].includes(t.type)));

/** The on-screen keyboard is up: a text field has the focus on a touch screen and the viewport has shrunk under it
 *  (index.html's `interactive-widget` makes the viewport follow). Focus alone isn't enough: Android's Back gesture
 *  closes the keyboard and leaves the field focused, so the viewport is what says it went; the field is blurred then,
 *  so its ring goes with the keyboard. */
export function useKeyboard(): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    let tall = vv?.height ?? window.innerHeight;
    const shrunk = () => {
      const h = vv?.height ?? window.innerHeight;
      if (h > tall) tall = h;
      return tall - h >= KEYBOARD_MIN;
    };
    const on = (e: FocusEvent) => { if (touching() && field(e.target)) setUp(true); };
    const off = (e: FocusEvent) => { if (!field(e.relatedTarget)) setUp(false); };
    const resize = () => {
      if (!touching()) return;
      if (shrunk()) { if (field(document.activeElement)) setUp(true); return; }
      // The keyboard went while a field kept the focus (Back gesture): let the field go too
      if (field(document.activeElement)) document.activeElement.blur();
      setUp(false);
    };
    addEventListener("focusin", on);
    addEventListener("focusout", off);
    (vv ?? window).addEventListener("resize", resize);
    return () => {
      removeEventListener("focusin", on);
      removeEventListener("focusout", off);
      (vv ?? window).removeEventListener("resize", resize);
    };
  }, []);
  return up;
}
