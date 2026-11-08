// Whether the on-screen keyboard is up, for what hides under it (the phone's tab bar, components/tab-bar.tsx).
import { useEffect, useState } from "react";
import { touching } from "./media";

/** A text field has the focus on a touch screen: the on-screen keyboard is up (the viewport follows it, index.html's `interactive-widget`). */
export function useKeyboard(): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const field = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || t instanceof HTMLTextAreaElement
      || (t instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "range", "file", "color"].includes(t.type)));
    const on = (e: FocusEvent) => { if (touching() && field(e.target)) setUp(true); };
    const off = (e: FocusEvent) => { if (!(field(e.relatedTarget))) setUp(false); };
    addEventListener("focusin", on);
    addEventListener("focusout", off);
    return () => { removeEventListener("focusin", on); removeEventListener("focusout", off); };
  }, []);
  return up;
}
