// A scene's time, and the few questions a scene asks of it. Every move in the film is a function of this: nothing animates
// by itself (no CSS transition, no timer), so any frame can be drawn alone, in any order, and comes out the same.
import type { CSSProperties } from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

/** The site's curve (its .reveal): quick out of the gate, a long settle. */
const EASE = Easing.bezier(0.2, 0.7, 0.2, 1);

/** Seconds since the scene began, with what is asked of them. */
export function useClock() {
  const t = useCurrentFrame() / useVideoConfig().fps;
  return {
    t,
    /** 0 until `from`, 1 from `from + over` on, eased between. */
    ramp: (from: number, over = 0.6) => interpolate(t, [from, from + over], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
    /** Whether `at` has come. */
    after: (at: number) => t >= at,
    /** `text` as far as it has been typed since `from`. */
    typed: (text: string, from: number, perSecond = 26) => text.slice(0, Math.max(0, Math.floor((t - from) * perSecond))),
  };
}

/** The style of something `p` of the way in (0 to 1): fading up, `by` pixels below its place until it gets there. */
export const rise = (p: number, by = 24): CSSProperties => ({ opacity: p, transform: `translateY(${(1 - p) * by}px)` });
