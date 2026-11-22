// A note's save state as one small drawn mark, no words: a line being written while there is typing to save, a ring drawing
// itself while it goes, a tick drawn once it is kept, a struck ring when it failed. The state is the mark's label, for
// screen readers and the tooltip.
import { AnimatePresence, motion, type Transition } from "motion/react";
import type { Status } from "@/hooks/draft";
import { cn } from "@/lib/utils";

const LABEL: Record<Status, string> = { saved: "Saved", unsaved: "Editing", saving: "Saving", error: "Not saved" };

const draw: Transition = { duration: 0.4, ease: "easeOut" };

function Paths({ status }: { status: Status }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  switch (status) {
    case "unsaved":
      return <motion.path {...p} d="M4 13c2-3 3-3 4 0s2 3 4 0 3-3 4 0 2 2 4 0" initial={{ pathLength: 0 }}
        animate={{ pathLength: [0, 1, 1], opacity: [1, 1, 0.4] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }} />;
    case "saving":
      return <motion.circle {...p} cx="12" cy="12" r="8" initial={{ pathLength: 0.1, rotate: 0 }}
        animate={{ pathLength: [0.1, 0.7, 0.1], rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} />;
    case "saved":
      return <motion.path {...p} d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={draw} />;
    case "error":
      return (
        <>
          <motion.circle {...p} cx="12" cy="12" r="8" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={draw} />
          <motion.path {...p} d="M12 8v4.5M12 16h.01" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ ...draw, delay: 0.3 }} />
        </>
      );
  }
}

export function SaveMark({ status, className }: { status: Status; className?: string }) {
  return (
    <span role="status" aria-live="polite" aria-label={LABEL[status]} title={LABEL[status]}
      className={cn("pointer-events-auto inline-grid size-5 place-items-center", status === "error" ? "text-down" : "text-faint", className)}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.svg key={status} viewBox="0 0 24 24" className="size-4" aria-hidden
          initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.15 }}>
          <Paths status={status} />
        </motion.svg>
      </AnimatePresence>
    </span>
  );
}
