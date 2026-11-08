// An item of a list on its way out (an `AnimatePresence` child whose exit is playing) can no longer be tabbed to, and hands the focus to
// the item beside it (unless `sibling` is off) else to `fallback`, the closest ancestor matching it, if one is given; one that comes back
// (a take-back) is live again.
import { useIsPresent } from "motion/react";
import { useLayoutEffect, useRef } from "react";

/** The ref for the item's element; call from the component that is the `AnimatePresence` child (or inside it).
 *  `sibling: false` for an element whose neighbours are not its kind (a section, a sheet): only `fallback` takes the focus. */
export function useLeaving<T extends HTMLElement>(fallback?: string, { sibling = true }: { sibling?: boolean } = {}) {
  const ref = useRef<T>(null), present = useIsPresent();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!present && el.contains(document.activeElement)) {
      const near = sibling ? (el.nextElementSibling ?? el.previousElementSibling)?.querySelector<HTMLElement>("button, a, input") : null;
      (near ?? (fallback ? el.closest<HTMLElement>(fallback) : null))?.focus({ preventScroll: true });
    }
    el.inert = !present;
  }, [present, fallback, sibling]);
  return ref;
}
