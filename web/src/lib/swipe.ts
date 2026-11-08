// The geometry of a task row's swipe, as the phone's (mobile/src/ui/tasks.tsx, ReanimatedSwipeable): the row follows the
// finger at half speed (friction 2), never past the width of what it uncovers; let go past `WHEN_AT` to the right and When
// is asked, past `DELETE_AT` to the left and the task is deleted (the list's take-back banner is the confirmation); either
// way the row snaps back. Pure: the hook (hooks/swipe.ts) feeds it pixels.
export const FRICTION = 2;
export const WHEN_WIDTH = 96, WHEN_AT = 64;
export const DELETE_WIDTH = 80, DELETE_AT = 56;
/** px a finger travels sideways before the press is a swipe. */
export const CLAIM = 10;

export type Outcome = "when" | "delete" | "closed";

/** Where the row sits for a finger `dx` px from where it went down, the row starting `from` (0, or mid-glide back to it).
 *  `when`: a right swipe is allowed (not on a row that is done). */
export function offsetOf(dx: number, from: number, when: boolean): number {
  const x = (dx + from * FRICTION) / FRICTION;
  return Math.min(when ? WHEN_WIDTH : 0, Math.max(-DELETE_WIDTH, x));
}

/** What letting go at `x` means. */
export function outcomeOf(x: number): Outcome {
  if (x >= WHEN_AT) return "when";
  if (x <= -DELETE_AT) return "delete";
  return "closed";
}
