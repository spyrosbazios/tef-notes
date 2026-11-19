// A note action's run on screen (hooks/note-run.ts): the panel that opens when one of a note's assistant buttons is pressed.
// It is the run's own chat drawn as the dock draws one (assistant/turn.tsx): the steps as they happen, the diff or the task
// as the usual card to accept or reject, then the answer. On a laptop it slides in at the note's top right and the note stays
// in reach under it; on a phone it is a sheet from the bottom edge, swiped down to close. While the reply is on its way a sheen
// crosses the note (`RunSheen`). A run that wrote closes by itself and says so in a toast (the note's change with an Undo);
// one that only answers stays until closed. "Open in chat" hands it to the dock.
import { useChat } from "@ai-sdk/react";
import { ShimmeringText } from "@animate-ui/react/primitives/texts/shimmering";
import { transition, useShouldReduceMotion, useTempoTransition } from "@animate-ui/react/utils/motion";
import type { UIMessage } from "ai";
import { ArrowUpRight, RotateCw, Square, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Turn } from "@/components/assistant/turn";
import { PROMPT_ICON } from "@/components/note-action-icons";
import { Button } from "@/components/ui/button";
import { cardsOf } from "@/core/agent";
import type { ChoiceOutput } from "@/core/assistant";
import { RESULT_ABOUT, type Result } from "@/core/note-actions";
import { useAssistant } from "@/hooks/assistant";
import { useNarrow } from "@/hooks/media";
import type { NoteRun } from "@/hooks/note-run";
import { useStick } from "@/hooks/stick";
import { asking, isTool, toolName, waiting } from "@/lib/ask";

/** The writes a run ends in, by its result: one of these done is the run done. */
const WRITES: Record<Result, readonly string[]> = { edit: ["rewrite_note", "append_to_note"], task: ["add_task"], answer: [] };

const textOf = (m: UIMessage | undefined) => (m?.parts ?? []).map((p) => (p.type === "text" ? p.text : "")).filter(Boolean).join(" ").trim();

/** Whether the reply made the write its action ends in. */
const wrote = (m: UIMessage | undefined, result: Result) => m?.role === "assistant" && m.parts.some((p) =>
  isTool(p) && WRITES[result].includes(toolName(p)) && p.state === "output-available" && cardsOf(p.output).length > 0);

type Props = {
  run: NoteRun;
  onClose: () => void;
  onCarry: () => void;
  onAgain: () => void;
  /** The run made its write and the reply ended: `said`, the agent's closing line. Called once. */
  onWrote: (said: string) => void;
};

/** A line that shimmers while nothing else on the panel moves. */
function Working({ text }: { text: string }) {
  return <p className="text-sm text-dim"><ShimmeringText text={text} color="var(--tf-dim)" shimmeringColor="var(--tf-fg)" /></p>;
}

/** The run's chat: the agent's turns, and what the owner can do next. */
function Reply({ run, onCarry, onAgain, onWrote }: Omit<Props, "onClose"> & { run: NoteRun & { chat: NonNullable<NoteRun["chat"]> } }) {
  const { chat, action } = run;
  const { messages, status, error, regenerate, addToolApprovalResponse, addToolOutput } = useChat<UIMessage>({ chat });
  const { halt } = useAssistant();
  const choose = useCallback((toolCallId: string, output: ChoiceOutput) => { void addToolOutput({ tool: "ask_choice", toolCallId, output }); }, [addToolOutput]);
  const busy = status === "submitted" || status === "streaming";
  const last = messages[messages.length - 1], asked = !!asking(last);
  const { el, onScroll } = useStick<HTMLDivElement>(messages, status);

  // The write made and the reply over: the panel has nothing left to show that the note doesn't
  const done = !busy && !asked && !error && wrote(last, action.result);
  const told = useRef(false), said = textOf(last);
  useEffect(() => {
    if (!done || told.current) return;
    told.current = true;
    onWrote(said);
  }, [done, said, onWrote]);

  return (
    <>
      <div ref={el} onScroll={onScroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3.5 py-2">
        {messages.map((m) => (m.role === "user" ? null : (
          <Turn key={m.id} m={m} streaming={status === "streaming" && m === last} live={busy && m === last} last={m === last} respond={addToolApprovalResponse} choose={choose} />
        )))}
        {waiting(last, busy) ? <Working text={last?.role === "assistant" ? "Working…" : "Reading the note…"} /> : null}
        {error ? (
          <div role="alert" className="flex items-center gap-2 text-sm text-down">
            <TriangleAlert className="size-4 shrink-0" /><span className="min-w-0 flex-1 break-words">{error.message}</span>
            <Button size="sm" variant="secondary" className="rounded-full" onClick={() => { void regenerate(); }}>Retry</Button>
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-3 py-2">
        {busy ? (
          <Button size="sm" variant="secondary" className="rounded-full" onClick={() => { void halt(chat); }}><Square className="fill-current" />Stop</Button>
        ) : asked ? (
          <p className="text-[13px] text-dim">Accept or reject above.</p>
        ) : (
          <Button size="sm" variant="secondary" className="rounded-full" onClick={onAgain}><RotateCw />Run again</Button>
        )}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" className="rounded-full text-dim" onClick={onCarry}><ArrowUpRight />Open in chat</Button>
      </div>
    </>
  );
}

/** The panel's content, the same on a laptop and a phone. */
function Panel({ run, onClose, ...rest }: Props) {
  const Icon = PROMPT_ICON[run.action.icon];
  return (
    <div data-assistant className="flex max-h-full min-h-0 flex-col" onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}>
      <div className="flex items-center gap-2 px-3.5 pt-3 pb-1.5">
        <Icon className="size-4 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{run.action.label}</p>
          <p className="truncate text-xs text-faint">{RESULT_ABOUT[run.action.result]}</p>
        </div>
        <Button variant="ghost" size="icon-sm" className="shrink-0 text-dim" aria-label="Close" onClick={onClose}><X /></Button>
      </div>
      {run.chat ? <Reply key={run.chat.id} run={{ ...run, chat: run.chat }} {...rest} /> : <div className="px-3.5 pt-2 pb-4"><Working text="Starting…" /></div>}
    </div>
  );
}

/** The laptop's: a card at the note's top right, inside the note's own box (so the dock beside it is never covered). */
function Aside(props: Props) {
  const reduce = useShouldReduceMotion();
  const enter = useTempoTransition(transition.sheet), leave = useTempoTransition(transition.dismiss);
  const hidden = { opacity: 0, x: reduce ? 0 : 24 };
  return (
    <motion.aside role="dialog" aria-label={props.run.action.label}
      initial={hidden} animate={{ opacity: 1, x: 0, transition: enter }} exit={{ ...hidden, transition: leave }}
      className="absolute top-3 right-3 z-20 flex max-h-[calc(100%-1.5rem)] w-[min(26rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10">
      <Panel {...props} />
    </motion.aside>
  );
}

/** The phone's: a sheet from the bottom edge, swiped down to close. */
function Sheet(props: Props) {
  const reduce = useShouldReduceMotion();
  const enter = useTempoTransition(transition.sheet), leave = useTempoTransition(transition.dismiss);
  const hidden = { opacity: reduce ? 0 : 1, y: reduce ? 0 : "100%" };
  return createPortal(
    <motion.div role="dialog" aria-label={props.run.action.label}
      initial={hidden} animate={{ opacity: 1, y: 0, transition: enter }} exit={{ ...hidden, transition: leave }}
      drag={reduce ? false : "y"} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
      onDragEnd={(_, info) => { if (info.offset.y > 80 || info.velocity.y > 500) props.onClose(); }}
      className="fixed inset-x-0 bottom-0 z-50 flex max-h-[75dvh] flex-col rounded-t-2xl bg-popover pb-[env(safe-area-inset-bottom)] text-popover-foreground shadow-lg ring-1 ring-foreground/10">
      <div aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line" />
      <Panel {...props} />
    </motion.div>,
    document.body,
  );
}

/** The panel with its exit: present while a run is open; a second run takes the first's place in it. */
export function NoteRunPanel({ run, ...rest }: Omit<Props, "run"> & { run: NoteRun | null }) {
  const narrow = useNarrow();
  return (
    <AnimatePresence>
      {run ? (narrow ? <Sheet key="run" run={run} {...rest} /> : <Aside key="run" run={run} {...rest} />) : null}
    </AnimatePresence>
  );
}

/** A sheen crossing the note while its action runs; a still tint when the OS asks for less motion. */
export function RunSheen({ on }: { on: boolean }) {
  const reduce = useShouldReduceMotion();
  const fade = useTempoTransition(transition.fade);
  return (
    <AnimatePresence>
      {on ? (
        <motion.div aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1, transition: fade }} exit={{ opacity: 0, transition: fade }}
          className="pointer-events-none absolute inset-0 z-10 overflow-hidden bg-brand/[0.03]">
          {reduce ? null : (
            <motion.div className="absolute inset-y-0 w-1/2 bg-linear-to-r from-transparent via-brand/10 to-transparent"
              initial={{ x: "-100%" }} animate={{ x: "200%" }} transition={{ duration: 1.8, ease: "linear", repeat: Infinity, repeatDelay: 0.2 }} />
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
