// A label or an icon taking another's place in place (Animate UI's swap): the old one fades out through a light blur while the new
// one comes in from it. Opacity and blur only, no scale: a text never scales, and the box around it keeps its size (`Turns`).
import { blur, transition, useTempoTransition } from "@animate-ui/react/utils/motion";
import { AnimatePresence, motion } from "motion/react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** `id` changes: `children` swap for the new ones. Nothing animates on mount. */
export function Swap({ id, children }: { id: string | number; children: ReactNode }) {
  const swap = useTempoTransition(transition.swap);
  return (
    <span className="relative inline-flex">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={id} className="inline-flex items-center gap-1.5" initial={{ opacity: 0, filter: blur.icon }}
          animate={{ opacity: 1, filter: "blur(0px)", transition: swap }} exit={{ opacity: 0, filter: blur.icon, transition: swap }}>
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** A label taking turns in a control: every state sits invisible in one grid cell, so the box is as wide as the widest of them in the
 *  font it is set in (a `min-width` in `ch` would be a guess) and the control keeps its size while the shown state swaps. */
export function Turns<S extends string>({ states, state, className, ...props }: { states: Record<S, ReactNode>; state: S } & Omit<ComponentProps<"span">, "children">) {
  return (
    <span className={cn("inline-grid place-items-center", className)} {...props}>
      {(Object.keys(states) as S[]).map((k) => <span key={k} aria-hidden className="invisible whitespace-nowrap [grid-area:1/1]">{states[k]}</span>)}
      <span className="whitespace-nowrap [grid-area:1/1]"><Swap id={state}>{states[state]}</Swap></span>
    </span>
  );
}
