// The conversation, while the owner is somewhere else (the assistant just opened a note, say) and Talk's panel is closed: a pill
// with the orb itself, small (orb.tsx: it breathes, swells, circles and rings as on Talk's page, and follows the real levels), and in
// words what the assistant is doing, down to which call ("Reading a note · Groceries"). A tap opens it into a small menu, the pill
// growing into it on one spring: the last thing said, Mute, Talk's page (Answer, while a card waits for a tap) and End, which is in
// the menu and not on the pill so a stray thumb never ends a conversation. A tap outside, Escape or a change of screen closes the
// menu. Not on the Talk page, which is all of this and more. It comes and goes on a spring from the edge it sits at: the top of a
// phone, the bottom of a window.
import { spring, transition, useTempoTransition } from "@animate-ui/react/utils/motion";
import { AudioLines, ChevronDown, Mic, MicOff, PhoneOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Swap } from "@/components/swap";
import { Orb } from "@/components/talk/orb";
import { Button } from "@/components/ui/button";
import { label as toolLabel } from "@/core/agent";
import { detailOf } from "@/core/tool-words";
import { useNarrow } from "@/hooks/media";
import { useNotes } from "@/hooks/notes";
import { useNow } from "@/hooks/now";
import { useTalk } from "@/hooks/talk";
import { useTasks } from "@/hooks/todo";
import { toolName } from "@/lib/ask";
import { haptic } from "@/lib/haptics";
import { useNav, usePlace } from "@/lib/nav";
import { useTalkPanel } from "@/lib/talk-panel";
import { clock, rowsOf, runningCall, type TalkState } from "@/lib/talk";
import { cn } from "@/lib/utils";

const WORDS: Partial<Record<TalkState, string>> = {
  connecting: "Connecting", listening: "Listening", thinking: "Thinking", speaking: "Speaking", working: "Working", waiting: "Waiting for you",
};

/** What the pill says: the state in a word or, while a call runs, the call as the chat names it, and which note, task or query. */
function useDoing(): { label: string; detail: string } {
  const { state, muted, messages } = useTalk();
  const { data: notes } = useNotes(), tasks = useTasks().data;
  return useMemo(() => {
    const call = state === "working" ? runningCall(messages) : undefined;
    if (!call) return { label: state === "listening" && muted ? "Muted" : WORDS[state] ?? "Talk", detail: "" };
    const name = toolName(call), input = call.input && typeof call.input === "object" ? call.input as Record<string, unknown> : {};
    const titleOf = (path: unknown) => notes?.find((n) => n.path === path)?.note.title || (typeof path === "string" ? path : "");
    const detail = name === "open_note" ? titleOf(input.path) : name === "open_task" ? tasks?.find((t) => t.id === input.id)?.title ?? "" : detailOf(name, input, titleOf);
    return { label: toolLabel(name), detail };
  }, [state, muted, messages, notes, tasks]);
}

/** The newest thing either side said, for the open pill: who, and the words. */
function useLastSaid() {
  const { messages } = useTalk();
  return useMemo(() => rowsOf(messages).rows.findLast((r) => r.kind === "said"), [messages]);
}

function Menu({ id, close }: { id: string; close: () => void }) {
  const { state, phase, muted, session } = useTalk();
  const { goView } = useNav();
  const said = useLastSaid();
  const fade = useTempoTransition(transition.fade);
  const waiting = state === "waiting";
  return (
    <motion.div id={id} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: fade }} exit={{ opacity: 0, transition: { duration: 0 } }} className="space-y-3 px-3 pt-1 pb-3">
      {said?.kind === "said" ? (
        <p className="line-clamp-2 px-1 text-[13px] leading-snug text-dim">
          <span className="font-medium text-faint">{said.who === "you" ? "You" : "Assistant"}</span> {said.text}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button variant={muted ? "secondary" : "outline"} size="icon-lg" disabled={phase !== "live"} aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted} title={muted ? "Unmute" : "Mute"}
          className="size-11 shrink-0 rounded-full [&_svg:not([class*='size-'])]:size-5" onClick={() => { haptic("tap"); session.mute(!muted); }}>
          <Swap id={muted ? "off" : "on"}>{muted ? <MicOff /> : <Mic />}</Swap>
        </Button>
        <Button variant={waiting ? "default" : "outline"} className="h-11 min-w-0 flex-1 rounded-full text-sm [&_svg:not([class*='size-'])]:size-4"
          onClick={() => { haptic("tap"); close(); goView({ kind: "talk" }); }}>
          <AudioLines /> {waiting ? "Answer" : "Open Talk"}
        </Button>
        <Button variant="destructive" className="h-11 shrink-0 rounded-full px-4 text-sm [&_svg:not([class*='size-'])]:size-4" onClick={() => { haptic("tick"); session.end(); }}>
          <PhoneOff /> End
        </Button>
      </div>
    </motion.div>
  );
}

function Pill() {
  const { state, muted, startedAt } = useTalk();
  const phone = useNarrow(), { view, note } = usePlace();
  const { label, detail } = useDoing();
  const [open, setOpen] = useState(false);
  const now = useNow(1000);
  const box = useRef<HTMLDivElement>(null), menu = useId();
  const pop = useTempoTransition(spring.pop), fade = useTempoTransition(transition.fade), away = useTempoTransition(transition.dismiss);
  const morph = useTempoTransition(spring.morph);

  // The menu is the screen's it was opened on: moving on closes it
  const place = `${view.kind}:${note ?? ""}`;
  const [at, setAt] = useState(place);
  if (at !== place) { setAt(place); setOpen(false); }

  useEffect(() => {
    if (!open) return;
    const out = (e: PointerEvent) => { if (e.target instanceof Node && !box.current?.contains(e.target)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", out, true);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", out, true); document.removeEventListener("keydown", key); };
  }, [open]);

  const edge = phone ? -12 : 12;
  const waiting = state === "waiting";
  return (
    <motion.div ref={box} layout role="status" style={{ borderRadius: 24 }} transition={{ layout: morph }}
      initial={{ opacity: 0, y: edge, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1, transition: { ...pop, opacity: fade } }}
      exit={{ opacity: 0, y: edge, scale: 0.96, transition: away }}
      className={cn("pointer-events-auto max-w-[calc(100vw-1.5rem)] overflow-hidden border bg-card/90 shadow-lg backdrop-blur-md transition-colors",
        open ? "w-80" : "", waiting ? "border-warn/60" : "border-line")}>
      <motion.button layout="position" type="button" aria-expanded={open} aria-controls={menu} aria-label={`Talk: ${label}${detail ? `, ${detail}` : ""}`}
        onClick={() => { haptic("tap"); setOpen((o) => !o); }}
        className="flex h-12 w-full items-center gap-2 pr-3.5 pl-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
        <Orb state={state} muted={muted} bare className="size-9 shrink-0" />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {muted ? <MicOff aria-hidden className="size-3.5 shrink-0 text-dim" /> : null}
          <span className={cn("shrink-0 font-medium", waiting ? "text-warn" : "")}><Swap id={label}>{label}</Swap></span>
          {detail ? <span className={cn("min-w-0 truncate text-dim", open ? "" : "max-w-40")}>{detail}</span> : null}
        </span>
        {open && startedAt != null ? <span className="shrink-0 text-xs tabular-nums text-faint">{clock((now - startedAt) / 1000)}</span> : null}
        <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-faint transition-transform duration-200 motion-reduce:transition-none", open ? "rotate-180" : "")} />
      </motion.button>
      <AnimatePresence initial={false} mode="popLayout">
        {open ? <Menu key="menu" id={menu} close={() => setOpen(false)} /> : null}
      </AnimatePresence>
    </motion.div>
  );
}

export function TalkPill() {
  const { phase } = useTalk();
  const { view } = usePlace();
  const panel = useTalkPanel();
  const shown = (phase === "connecting" || phase === "live") && view.kind !== "talk" && !panel;
  return (
    <div className="pointer-events-none absolute inset-x-0 z-[60] flex justify-center max-md:top-[calc(env(safe-area-inset-top)+0.5rem)] md:bottom-5">
      <AnimatePresence>{shown ? <Pill key="pill" /> : null}</AnimatePresence>
    </div>
  );
}
