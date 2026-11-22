// A note's save state as one small drawn mark, no words, at the editor's bottom left. What it says, most pressing first: a save
// that failed (a struck ring), typing waiting to be saved (a line being written), a save going (a ring drawing itself); then
// the connection (hooks/sync.ts `useConnection`): offline (a cloud, struck), changes the last sync could not send (a cloud with
// a bang), changes the server refused (a struck circle), the copy not kept on this device (a disk, struck), changes on their
// way up (an arrow rising into a cloud); else a tick, drawn once. The word is the mark's label, for screen readers and the tooltip.
import { AnimatePresence, motion, type Transition } from "motion/react";
import type { Status } from "@/hooks/draft";
import { useConnection, type Connection } from "@/hooks/sync";
import { cn } from "@/lib/utils";

type Mark = Exclude<Status, "saved"> | Exclude<Connection, null> | "saved";

const draw: Transition = { duration: 0.4, ease: "easeOut" };
const p = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const CLOUD = "M7 18a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 9a3.5 3.5 0 0 1 .5 7H7";

/** A path drawn in, after `delay` seconds. */
const Drawn = ({ d, delay = 0 }: { d: string; delay?: number }) =>
  <motion.path {...p} d={d} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ ...draw, delay }} />;

function Paths({ mark }: { mark: Mark }) {
  switch (mark) {
    case "unsaved":
      return <motion.path {...p} d="M4 13c2-3 3-3 4 0s2 3 4 0 3-3 4 0 2 2 4 0" initial={{ pathLength: 0 }}
        animate={{ pathLength: [0, 1, 1], opacity: [1, 1, 0.4] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }} />;
    case "saving":
      return <motion.circle {...p} cx="12" cy="12" r="8" initial={{ pathLength: 0.1, rotate: 0 }}
        animate={{ pathLength: [0.1, 0.7, 0.1], rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} />;
    case "saved":
      return <Drawn d="M5 12.5l4.5 4.5L19 7.5" />;
    case "error":
      return <><Drawn d="M12 4a8 8 0 1 1 0 16a8 8 0 1 1 0-16" /><Drawn d="M12 8v4.5M12 16h.01" delay={0.3} /></>;
    case "offline":
      return <><Drawn d={CLOUD} /><Drawn d="M3 3l18 18" delay={0.3} /></>;
    case "stuck":
      return <><Drawn d={CLOUD} /><Drawn d="M12 10v3M12 15.5h.01" delay={0.3} /></>;
    case "refused":
      return <><Drawn d="M12 4a8 8 0 1 1 0 16a8 8 0 1 1 0-16" /><Drawn d="M6.5 6.5l11 11" delay={0.3} /></>;
    case "notKept":
      return <><Drawn d="M4 15h16v4H4zM6 15l2-9h8l2 9" /><Drawn d="M3 3l18 18" delay={0.3} /></>;
    case "sending":
      return (
        <>
          <Drawn d={CLOUD} />
          <motion.path {...p} d="M12 17v-6M9.5 13.5L12 11l2.5 2.5" initial={{ y: 3, opacity: 0 }}
            animate={{ y: [3, 0, -1], opacity: [0, 1, 0] }} transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }} />
        </>
      );
  }
}

const LABEL: Record<Mark, string> = {
  saved: "Saved", unsaved: "Editing", saving: "Saving", error: "Not saved",
  offline: "Offline: saved here, sent when back online", stuck: "Changes could not be sent", refused: "Changes refused: see Settings",
  notKept: "Not saved on this device", sending: "Sending",
};
const BAD: ReadonlySet<Mark> = new Set(["error", "stuck", "refused", "notKept"]);

export function SaveMark({ status, className }: { status: Status; className?: string }) {
  const { state } = useConnection();
  const mark: Mark = status !== "saved" ? status : state ?? "saved";
  return (
    <span role="status" aria-live="polite" aria-label={LABEL[mark]} title={LABEL[mark]}
      className={cn("pointer-events-auto inline-grid size-5 place-items-center", BAD.has(mark) ? "text-down" : "text-faint", className)}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.svg key={mark} viewBox="0 0 24 24" className="size-4" aria-hidden
          initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.15 }}>
          <Paths mark={mark} />
        </motion.svg>
      </AnimatePresence>
    </span>
  );
}
