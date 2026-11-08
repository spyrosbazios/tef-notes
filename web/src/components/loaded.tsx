// A placeholder giving way to what it stood for, in place (Animate UI's skeleton recipe): the skeleton fades out while the content comes
// in from a light blur, overlapping, so nothing jumps between. Content that is there when this mounts shows at once. `blurred: false`
// for a surface as large as Home's tiles, which a blur filter would make costly to paint: it fades alone.
import { blur, transition, useTempoTransition } from "@animate-ui/react/utils/motion";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

export function Loaded({ loading, skeleton, children, blurred = true, className }: {
  loading: boolean; skeleton: ReactNode; children: ReactNode; blurred?: boolean; className?: string;
}) {
  const fade = useTempoTransition(transition.fade), reveal = useTempoTransition(transition.reveal);
  return (
    <div className="relative">
      <AnimatePresence mode="popLayout" initial={false}>
        {loading ? (
          <motion.div key="skeleton" aria-hidden className={className} exit={{ opacity: 0, transition: fade }}>{skeleton}</motion.div>
        ) : (
          <motion.div key="content" className={className} initial={blurred ? { opacity: 0, filter: blur.surface } : { opacity: 0 }}
            animate={blurred ? { opacity: 1, filter: "blur(0px)", transition: reveal } : { opacity: 1, transition: reveal }}>
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
