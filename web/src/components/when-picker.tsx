// The When choice of a task, as Things has it: Today, This Evening, Tomorrow or a day (typed in words -- "fri",
// "in 3d", "nov 12" -- or picked), and a deadline beside it. Used in a popover on a list row and in the quick-add dialog.
import { Check, Flag, Moon, Star, Sunrise, X } from "lucide-react";
import { useState } from "react";
import { addDays, parseWhen, whenLabel, type Schedule } from "@/core/dates";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Where a task stands: what When and Deadline show. */
export type WhenState = { when: string | null; evening: boolean; due: string | null };

function Choice({ icon: Icon, label, on, onClick }: { icon: typeof Star; label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={cn("flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm transition-colors hover:bg-muted", on && "font-semibold")}>
      <Icon className="size-4 shrink-0 text-dim" />
      <span className="flex-1">{label}</span>
      {on ? <Check className="size-3.5 text-brand" /> : null}
    </button>
  );
}

export function WhenPicker({ value, today, onSchedule, onDue }: {
  value: WhenState; today: string; onSchedule: (s: Schedule | null) => void; onDue: (day: string | null) => void;
}) {
  const [typed, setTyped] = useState("");
  const guess = typed.trim() ? parseWhen(typed, today) : null;
  const tomorrow = addDays(today, 1);
  const scheduled = value.when != null;
  const preview = guess ? whenLabel(guess, today) : null;
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="fri, in 3d, nov 12…" aria-label="When, in words" autoFocus
          onKeyDown={(e) => { if (e.key === "Enter" && guess) { e.preventDefault(); onSchedule(guess); } }} />
        {typed.trim() ? (
          <p className={cn("px-1 text-xs", guess ? "text-dim" : "text-faint")}>{preview ? `Press Enter: ${preview}` : "Not a day I know."}</p>
        ) : null}
      </div>
      <div className="space-y-0.5">
        <Choice icon={Star} label="Today" on={value.when === today && !value.evening} onClick={() => onSchedule({ when: today, evening: false })} />
        <Choice icon={Moon} label="This Evening" on={value.when === today && value.evening} onClick={() => onSchedule({ when: today, evening: true })} />
        <Choice icon={Sunrise} label="Tomorrow" on={value.when === tomorrow && !value.evening} onClick={() => onSchedule({ when: tomorrow, evening: false })} />
        {scheduled ? <Choice icon={X} label="Clear" on={false} onClick={() => onSchedule(null)} /> : null}
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

/** The picker in a popover on `children` (the trigger). It closes once a day is chosen. */
export function WhenPopover({ children, value, today, onSchedule, onDue, align = "end" }: {
  children: React.ReactNode; value: WhenState; today: string; onSchedule: (s: Schedule | null) => void; onDue: (day: string | null) => void; align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-64" onClick={(e) => e.stopPropagation()}>
        <WhenPicker value={value} today={today} onSchedule={(s) => { onSchedule(s); setOpen(false); }} onDue={onDue} />
      </PopoverContent>
    </Popover>
  );
}
