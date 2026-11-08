// The dictation control, one for every place text is typed: a mic that, pressed, records (a ring that breathes with the
// voice, a timer, live bars, a cancel), and pressed again sends the clip to the server's speech model and hands the text to
// `onText`. Esc cancels. Hidden where the browser can't record. The recording itself: hooks/dictation.ts.
import { AnimatePresence, motion } from "motion/react";
import { Loader2, Mic, Square, X } from "lucide-react";
import { useEffect } from "react";
import { useShouldReduceMotion } from "@animate-ui/react/utils/motion";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { canDictate, useDictation } from "@/hooks/dictation";
import { cn } from "@/lib/utils";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const BARS = [0.55, 0.85, 1, 0.7, 0.45];
/** Keeps the field it dictates into focused: a press on the mic is not a click away from it. */
const keep = (e: React.SyntheticEvent) => e.preventDefault();

type Props = {
  onText: (text: string) => void;
  /** `field`: a quiet icon inside a text box; `bar`: a toolbar's icon. */
  variant?: "field" | "bar";
  className?: string;
};

export function MicButton({ onText, variant = "field", className }: Props) {
  const d = useDictation(onText);
  const calm = useShouldReduceMotion();
  const recording = d.state === "recording", busy = d.state === "starting" || d.state === "transcribing";

  useEffect(() => {
    if (!recording) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); d.cancel(); } };
    addEventListener("keydown", esc, true);
    return () => removeEventListener("keydown", esc, true);
  }, [recording, d]);

  if (!canDictate()) return null;

  return (
    <div className={cn("flex shrink-0 items-center gap-1.5", className)}>
      <AnimatePresence initial={false}>
        {recording || d.state === "transcribing" ? (
          <motion.div key="live" role="status" aria-live="polite"
            initial={calm ? false : { opacity: 0, x: 8, scale: 0.96 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={calm ? undefined : { opacity: 0, x: 8, scale: 0.96 }}
            className={cn("flex h-8 items-center gap-2 rounded-full border px-2.5 text-xs font-semibold tabular-nums",
              recording ? "border-down/40 bg-down/10 text-down" : "border-line bg-muted text-dim")}>
            {recording ? (
              <>
                <span className="relative flex size-2"><span className="absolute inset-0 animate-ping rounded-full bg-down opacity-70" /><span className="relative size-2 rounded-full bg-down" /></span>
                <span>Listening</span>
                <span className="flex h-4 items-center gap-[2px]" aria-hidden>
                  {BARS.map((b, i) => (
                    <motion.span key={i} className="w-[3px] rounded-full bg-down" animate={{ height: `${Math.max(3, 16 * Math.min(1, d.level * b * 1.6))}px` }} transition={{ duration: 0.08 }} />
                  ))}
                </span>
                <span>{clock(d.seconds)}</span>
                <button type="button" aria-label="Cancel dictation" title="Cancel (Esc)" onPointerDown={keep} onMouseDown={keep} onClick={d.cancel}
                  className="-mr-1 grid size-5 place-items-center rounded-full hover:bg-down/20"><X className="size-3.5" /></button>
              </>
            ) : (
              <><Loader2 className="size-3.5 animate-spin" /><span>Transcribing…</span></>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative grid place-items-center">
            {recording && !calm ? (
              <motion.span aria-hidden className="pointer-events-none absolute inset-0 rounded-full bg-down/25"
                animate={{ scale: 1 + d.level * 0.9 }} transition={{ type: "spring", stiffness: 400, damping: 18 }} />
            ) : null}
            <Button type="button" size="icon" variant="ghost"
              aria-label={recording ? "Stop and transcribe" : "Dictate"} aria-pressed={recording}
              disabled={busy} onPointerDown={keep} onMouseDown={keep} onClick={d.toggle}
              className={cn("relative shrink-0 rounded-full", recording ? "bg-down text-bg hover:bg-down/90 hover:text-bg" : variant === "field" ? "text-dim" : "text-dim hover:text-fg")}>
              {d.state === "starting" ? <Loader2 className="animate-spin" /> : recording ? <Square className="fill-current" /> : <Mic />}
            </Button>
          </div>
        </TooltipTrigger>
        <TooltipContent>{recording ? "Stop and transcribe" : "Dictate (English)"}</TooltipContent>
      </Tooltip>
    </div>
  );
}
