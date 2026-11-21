/** Typing in a field, or drawing (the drawing editor takes single keys for its tools, drawing-layer.tsx): single-key shortcuts
 *  stay out of the way. */
export const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement
  && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || !!e.target.closest("[data-drawing]"));

/** Pressing a button must not move the focus off the field being typed in: on a phone that drops the keyboard mid-tap (the layout
 *  shifts under the finger and the tap misses), and in the editor it would drop the selection. Its `onMouseDown` (and `onPointerDown`). */
export const keepFocus = (e: { preventDefault(): void }) => e.preventDefault();
