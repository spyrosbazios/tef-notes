// The conversation, while the owner is somewhere else (the assistant just opened a note, say): a small pill showing what it is doing,
// that takes them back to Talk on a tap and ends it from its own button. Not on the Talk page, which is all of this and more. The
// level bars are moved from the frame loop, not by React. It comes and goes on a spring from the edge it sits at: the top of a phone,
// the bottom of a window.
import { spring, transition, useTempoTransition } from "@animate-ui/react/utils/motion";
import { MicOff, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef } from "react";
import { Swap } from "@/components/swap";
import { useNarrow } from "@/hooks/media";
import { useNow } from "@/hooks/now";
import { useFrames, useTalk } from "@/hooks/talk";
import { haptic } from "@/lib/haptics";
import { follow } from "@/lib/orb";
import { useNav, usePlace } from "@/lib/nav";
import { clock, type TalkState } from "@/lib/talk";
import { cn } from "@/lib/utils";

const WORDS: Partial<Record<TalkState, string>> = { connecting: "Connecting", listening: "Listening", speaking: "Speaking", working: "Working", waiting: "Waiting for you" };
const BARS = [0.7, 1, 0.55];

function Pill() {
  const { state, muted, startedAt, session } = useTalk();
  const { goView } = useNav(), phone = useNarrow();
  const now = useNow(1000);
  const pop = useTempoTransition(spring.pop), fade = useTempoTransition(transition.fade), away = useTempoTransition(transition.dismiss);
  const bars = useRef<(HTMLSpanElement | null)[]>([]), level = useRef(0);
  useFrames((dt) => {
    const l = session.levels();
    level.current = follow(level.current, state === "speaking" ? l.voice : state === "listening" && !muted ? l.mic : 0, dt);
    bars.current.forEach((b, i) => { if (b) b.style.transform = `scaleY(${0.25 + Math.min(1, level.current * BARS[i] * 1.6) * 0.75})`; });
  });
  const edge = phone ? -12 : 12;
  const label = state === "listening" && muted ? "Muted" : WORDS[state] ?? "Talk";
  return (
    <motion.div role="status" initial={{ opacity: 0, y: edge, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1, transition: { ...pop, opacity: fade } }}
      exit={{ opacity: 0, y: edge, scale: 0.96, transition: away }}
      className={cn("pointer-events-auto flex h-10 items-center rounded-full border bg-card pr-1 pl-1 shadow-lg", state === "waiting" ? "border-warn/60" : "border-line")}>
      <button type="button" aria-label="Back to Talk" onClick={() => { haptic("tap"); goView({ kind: "talk" }); }}
        className="flex h-full items-center gap-2.5 rounded-full pr-2 pl-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {muted ? <MicOff className="size-4 text-dim" /> : (
          <span aria-hidden className={cn("flex h-4 items-center gap-[2px]", state === "working" || state === "connecting" ? "animate-pulse" : "", state === "waiting" ? "text-warn" : "text-brand")}>
            {BARS.map((_, i) => <span key={i} ref={(el) => { bars.current[i] = el; }} className="h-full w-[3px] origin-center rounded-full bg-current" style={{ transform: "scaleY(0.25)" }} />)}
          </span>
        )}
        <span className="min-w-0"><Swap id={label}>{label}</Swap></span>
        {startedAt != null ? <span className="text-xs tabular-nums text-faint max-md:hidden">{clock((now - startedAt) / 1000)}</span> : null}
      </button>
      <button type="button" aria-label="End the conversation" title="End" onClick={() => { haptic("tick"); session.end(); }}
        className="grid size-8 place-items-center rounded-full text-dim outline-none hover:bg-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"><X className="size-4" /></button>
    </motion.div>
  );
}

export function TalkPill() {
  const { phase } = useTalk();
  const { view } = usePlace();
  const shown = (phase === "connecting" || phase === "live") && view.kind !== "talk";
  return (
    <div className="pointer-events-none absolute inset-x-0 z-[60] flex justify-center max-md:top-[calc(env(safe-area-inset-top)+0.5rem)] md:bottom-5">
      <AnimatePresence>{shown ? <Pill key="pill" /> : null}</AnimatePresence>
    </div>
  );
}
