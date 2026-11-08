// An item of a list on its way out (an `AnimatePresence` child whose exit is playing) can no longer be tabbed to, and hands the focus to
// the item beside it (else to `fallback`, the closest ancestor matching it, if one is given); one that comes back (a take-back) is live again.
import { useIsPresent } from "motion/react";
import { useLayoutEffect, useRef } from "react";

/** The ref for the item's element; call from the component that is the `AnimatePresence` child. */
export function useLeaving<T extends HTMLElement>(fallback?: string) {
  const ref = useRef<T>(null), present = useIsPresent();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!present && el.contains(document.activeElement)) {
      const near = (el.nextElementSibling ?? el.previousElementSibling)?.querySelector<HTMLElement>("button, a, input");
      (near ?? (fallback ? el.closest<HTMLElement>(fallback) : null))?.focus({ preventScroll: true });
    }
    el.inert = !present;
  }, [present, fallback]);
  return ref;
}
