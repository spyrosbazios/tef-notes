// A field in error shakes "no" once (Animate UI's field-error recipe): a few dying swings of `shift.shake`. The colour and the message
// carry the error; this only draws the eye, so it is called once per failure, not per keystroke. Not under reduced motion.
import { shift, transition, useShouldReduceMotion, useTempoTransition } from "@animate-ui/react/utils/motion";
import { useAnimate } from "motion/react";
import { useCallback, useEffect, useRef } from "react";

/** `[scope, shake]`: put `scope` as the ref of the field; `shake` is stable. */
export function useShake<T extends HTMLElement>() {
  const [scope, animate] = useAnimate<T>();
  const reduce = useShouldReduceMotion(), timing = useTempoTransition(transition.shake);
  const latest = useRef({ reduce, timing });
  useEffect(() => { latest.current = { reduce, timing }; });
  const shake = useCallback(() => {
    const { reduce: calm, timing: t } = latest.current;
    if (calm || !scope.current) return;
    const s = shift.shake;
    void animate(scope.current, { x: [0, -s, s, -0.66 * s, 0.66 * s, -0.33 * s, 0.33 * s, 0] }, t);
  }, [animate, scope]);
  return [scope, shake] as const;
}
