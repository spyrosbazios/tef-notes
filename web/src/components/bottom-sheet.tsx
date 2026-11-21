// The phone's panel over a note: a sheet from the bottom edge, over the keyboard (the viewport shrinks with it), swiped down to
// close. An ask about selected words (selection-ask.tsx) and a note action's run (note-run.tsx) open in one; put it inside an
// AnimatePresence for its exit.
import { transition, useShouldReduceMotion, useTempoTransition } from "@animate-ui/react/utils/motion";
import { motion } from "motion/react";
import type { ReactNode, Ref } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export function BottomSheet({ label, onClose, className, ref, children }: {
  label: string;
  /** Swiped down far or fast enough. */
  onClose: () => void;
  className?: string;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  const reduce = useShouldReduceMotion();
  const enter = useTempoTransition(transition.sheet), leave = useTempoTransition(transition.dismiss);
  const hidden = { opacity: reduce ? 0 : 1, y: reduce ? 0 : "100%" };
  return createPortal(
    <motion.div ref={ref} role="dialog" aria-label={label}
      initial={hidden} animate={{ opacity: 1, y: 0, transition: enter }} exit={{ ...hidden, transition: leave }}
      drag={reduce ? false : "y"} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
      onDragEnd={(_, info) => { if (info.offset.y > 80 || info.velocity.y > 500) onClose(); }}
      className={cn("fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-popover pb-[env(safe-area-inset-bottom)] text-popover-foreground shadow-lg ring-1 ring-foreground/10", className)}>
      <div aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line" />
      {children}
    </motion.div>,
    document.body,
  );
}
