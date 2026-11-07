// The pickers a task's card and the new-task dialog share: one row per thing a task says about itself, the repeat
// (presets or words, core/todo.ts EVERY) and the reminder time (needs a date). Each takes a value and reports a change;
// the caller writes it.
import { Check, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { everyLabel } from "@/core/dates";
import { EVERY } from "@/core/todo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const REMIND_TIMES = ["08:00", "09:00", "12:00", "15:00", "18:00", "20:00"];
const REPEATS: [string, string][] = [["", "Never"], ["1d", "Every day"], ["1w", "Every week"], ["1m", "Every month"], ["1y", "Every year"]];

export const chip = "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-muted px-2.5 text-sm hover:text-fg";

/** One thing a task says about itself: its icon and name, and the control that changes it. */
export function Row({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-9 items-center gap-3">
      <Icon className="size-4 shrink-0 text-dim" />
      <span className="w-20 shrink-0 text-sm text-dim">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
    </div>
  );
}

export const Clear = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <Button type="button" variant="ghost" size="icon-sm" aria-label={label} title={label} onClick={onClick} className="size-6 text-faint"><X /></Button>
);

export function RepeatPicker({ value, onChange }: { value: string; onChange: (every: string) => void }) {
  const [open, setOpen] = useState(false), [custom, setCustom] = useState("");
  const set = (every: string) => { setOpen(false); setCustom(""); onChange(every); };
  const typed = custom.trim().toLowerCase(), valid = EVERY.test(typed);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><button type="button" className={cn(chip, !value && "text-faint")}>{value ? everyLabel(value) : "Never"}</button></PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <div className="space-y-0.5">
          {REPEATS.map(([v, label]) => (
            <button key={v} type="button" aria-pressed={value === v} onClick={() => set(v)}
              className={cn("flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm hover:bg-muted", value === v && "font-semibold")}>
              <span className="flex-1">{label}</span>{value === v ? <Check className="size-3.5 text-brand" /> : null}
            </button>
          ))}
        </div>
        <div className="space-y-1 border-t border-line pt-2">
          <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="2w, +3d, mon,thu…" aria-label="Repeat, in words"
            onKeyDown={(e) => { if (e.key === "Enter" && valid) { e.preventDefault(); set(typed); } }} />
          <p className="px-1 text-xs text-faint">{!typed ? "1d 2w 1m 1y: from the day. +3d: from the day it was done. mon,thu: those weekdays." : valid ? `Press Enter: ${everyLabel(typed)}` : "Not a repeat I know."}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The reminder's time: only a task with a date has one. */
export function RemindPicker({ value, dated, onChange }: { value: string; dated: boolean; onChange: (remind: string) => void }) {
  if (!dated) return <span className="text-sm text-faint">Needs a date</span>;
  const times = REMIND_TIMES.includes(value) || !value ? REMIND_TIMES : [...REMIND_TIMES, value].sort();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><button type="button" className={cn(chip, !value && "text-faint")}>{value || "None"}</button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-32">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          <DropdownMenuRadioItem value="">None</DropdownMenuRadioItem>
          {times.map((t) => <DropdownMenuRadioItem key={t} value={t}>{t}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
