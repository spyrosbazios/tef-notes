// The When choice of a task, as Things has it: Today, This Evening, Tomorrow or a day (typed in words -- "fri",
// "in 3d", "nov 12" -- or picked), and a deadline beside it. Used in a popover (a sheet at phone width, components/pick.tsx)
// on a list row, on the task's card and in the quick-add dialog.
import { AutoHeight } from "@animate-ui/react/primitives/effects/auto-height";
import { Highlight, HighlightItem } from "@animate-ui/react/primitives/effects/highlight";
import { Check, Flag, Moon, Star, Sunrise, X } from "lucide-react";
import { useState } from "react";
import { Pick } from "@/components/pick";
import { addDays, parseWhen, whenLabel, type Schedule } from "@/core/dates";
import { Input } from "@/components/ui/input";
import { useHovers } from "@/hooks/hover";
import { cn } from "@/lib/utils";

/** Where a task stands: what When and Deadline show. */
export type WhenState = { when: string | null; evening: boolean; due: string | null };

function Choice({ icon: Icon, label, on, onClick }: { icon: typeof Star; label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={cn("flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm transition-colors any-pointer-coarse:h-11", on && "font-semibold")}>
      <Icon className="size-4 shrink-0 text-dim" />
      <span className="flex-1">{label}</span>
      {on ? <Check className="size-3.5 text-brand" /> : null}
    </button>
  );
}

export function WhenPicker({ value, today, onSchedule, onDue }: {
  value: WhenState; today: string; onSchedule: (s: Schedule | null) => void; onDue: (day: string | null) => void;
}) {
  const [typed, setTyped] = useState(""), hovers = useHovers();
  const guess = typed.trim() ? parseWhen(typed, today) : null;
  const tomorrow = addDays(today, 1);
  const scheduled = value.when != null;
  const preview = guess ? whenLabel(guess, today) : null;
  return (
    <div className="space-y-2">
      <div>
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="fri, in 3d, nov 12…" aria-label="When, in words" autoFocus={!matchMedia("(pointer: coarse)").matches}
          onKeyDown={(e) => { if (e.key === "Enter" && guess) { e.preventDefault(); onSchedule(guess); } }} />
        {/* What the words mean opens its line as they are typed, and the picker below follows, rather than jumping */}
        <AutoHeight>
          {typed.trim() ? <p className={cn("px-1 pt-1 text-xs", guess ? "text-dim" : "text-faint")}>{preview ? `Press Enter: ${preview}` : "Not a day I know."}</p> : null}
        </AutoHeight>
      </div>
      {/* One background glides from option to option under a mouse (a finger has no hover: it keeps to the press) */}
      <div className="space-y-0.5">
      <Highlight controlledItems hover={hovers} className="inset-0 rounded-md bg-muted">
        <HighlightItem value="today"><Choice icon={Star} label="Today" on={value.when === today && !value.evening} onClick={() => onSchedule({ when: today, evening: false })} /></HighlightItem>
        <HighlightItem value="evening"><Choice icon={Moon} label="This Evening" on={value.when === today && value.evening} onClick={() => onSchedule({ when: today, evening: true })} /></HighlightItem>
        <HighlightItem value="tomorrow"><Choice icon={Sunrise} label="Tomorrow" on={value.when === tomorrow && !value.evening} onClick={() => onSchedule({ when: tomorrow, evening: false })} /></HighlightItem>
        {scheduled ? <HighlightItem value="clear"><Choice icon={X} label="Clear" on={false} onClick={() => onSchedule(null)} /></HighlightItem> : null}
      </Highlight>
      </div>
      <div className="space-y-1.5 border-t border-line pt-2">
        <label className="flex items-center gap-2 px-1 text-xs text-dim">
          <span className="w-16 shrink-0">On a day</span>
          <Input type="date" value={value.when ?? ""} aria-label="Day" onChange={(e) => { if (e.target.value) onSchedule({ when: e.target.value, evening: value.evening }); }} />
        </label>
        <label className="flex items-center gap-2 px-1 text-xs text-dim">
          <Flag className="size-3.5 shrink-0 text-warn" /><span className="w-[46px] shrink-0">Due</span>
          <Input type="date" value={value.due ?? ""} aria-label="Deadline" onChange={(e) => onDue(e.target.value || null)} />
          {value.due ? <button type="button" aria-label="Clear deadline" onClick={() => onDue(null)} className="rounded p-0.5 text-dim hover:text-fg"><X className="size-3.5" /></button> : null}
        </label>
      </div>
    </div>
  );
}

/** The picker on `children` (the trigger): a popover, a sheet at phone width. It closes once a day is chosen. `open` and
 *  `onOpenChange` make it controlled (a row's swipe opens it). */
export function WhenPick({ children, value, today, onSchedule, onDue, align = "end", open, onOpenChange }: {
  children: React.ReactNode; value: WhenState; today: string; onSchedule: (s: Schedule | null) => void; onDue: (day: string | null) => void;
  align?: "start" | "end"; open?: boolean; onOpenChange?: (o: boolean) => void;
}) {
  const [own, setOwn] = useState(false);
  const shown = open ?? own;
  const set = (o: boolean) => { setOwn(o); onOpenChange?.(o); };
  return (
    <Pick trigger={children} title="When" align={align} open={shown} onOpenChange={set}>
      <WhenPicker value={value} today={today} onSchedule={(s) => { onSchedule(s); set(false); }} onDue={onDue} />
    </Pick>
  );
}
