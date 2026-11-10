/** Typing in a field, or drawing (the drawing editor takes single keys for its tools, drawing-layer.tsx): single-key shortcuts
 *  stay out of the way. */
export const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement
  && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || !!e.target.closest("[data-drawing]"));
