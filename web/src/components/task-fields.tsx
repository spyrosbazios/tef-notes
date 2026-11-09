// The pickers a task's card and the new-task dialog share: one row per thing a task says about itself, the repeat
// (presets or words, core/todo.ts EVERY) and the reminder time (on the task's day, today when it has none). Each takes a value and reports a change;
// the caller writes it.
import { Check, X, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { everyLabel } from "@/core/dates";
import { REMIND_TIMES, REPEATS } from "@/core/things";
import { EVERY, type TaskPatch } from "@/core/todo";
import { Pick } from "@/components/pick";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { remindFields } from "@/lib/schedule";
import { cn } from "@/lib/utils";

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

const option = "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm hover:bg-muted any-pointer-coarse:h-11";

export function RepeatPicker({ value, onChange }: { value: string; onChange: (every: string) => void }) {
  const [open, setOpen] = useState(false), [custom, setCustom] = useState("");
  const set = (every: string) => { setOpen(false); setCustom(""); onChange(every); };
  const typed = custom.trim().toLowerCase(), valid = EVERY.test(typed);
  const preset = REPEATS.find((r) => r.every === value);
  return (
    <Pick title="Repeat" open={open} onOpenChange={setOpen} trigger={<button type="button" className={cn(chip, !value && "text-faint")}>{value ? everyLabel(value) : "Never"}</button>}>
      <div className="space-y-0.5">
        {[{ every: "", label: "Never" }, ...REPEATS].map((r) => (
          <button key={r.every} type="button" aria-pressed={value === r.every} onClick={() => set(r.every)} className={cn(option, value === r.every && "font-semibold")}>
            <span className="flex-1">{r.label}</span>{value === r.every ? <Check className="size-3.5 text-brand" /> : null}
          </button>
        ))}
        {value && !preset ? <p className={cn(option, "font-semibold hover:bg-transparent")}><span className="flex-1">Custom: {everyLabel(value)}</span><Check className="size-3.5 text-brand" /></p> : null}
      </div>
      <div className="space-y-1 border-t border-line pt-2">
        <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="2w, +3d, mon,thu…" aria-label="Repeat, in words"
          onKeyDown={(e) => { if (e.key === "Enter" && valid) { e.preventDefault(); set(typed); } }} />
        {valid ? <Button type="button" size="sm" className="w-full rounded-full" onClick={() => set(typed)}>Repeat {everyLabel(typed).toLowerCase()}</Button> : null}
        <p className="px-1 text-xs text-faint">{!typed ? "1d 2w 1m 1y: from the day. +3d: from the day it was done. mon,thu: those weekdays." : valid ? "" : "Not a repeat I know."}</p>
      </div>
    </Pick>
  );
}

/** The reminder's time, on the task's day: a task with no day gets today (a reminder needs its day), as on the phone. `onChange` is
 *  given what to write: the time, and today when it had no day. */
export function RemindPicker({ value, dated, today, onChange }: { value: string; dated: boolean; today: string; onChange: (fields: TaskPatch) => void }) {
  const [open, setOpen] = useState(false);
  const times = !value || REMIND_TIMES.includes(value) ? REMIND_TIMES : [...REMIND_TIMES, value].sort();
  const set = (remind: string) => { setOpen(false); onChange(remindFields(remind, dated, today)); };
  return (
    <Pick title="Remind me at" width="w-36" open={open} onOpenChange={setOpen} trigger={<button type="button" className={cn(chip, !value && "text-faint")}>{value || "None"}</button>}>
      <div className="space-y-0.5">
        {["", ...times].map((t) => (
          <button key={t} type="button" aria-pressed={value === t} onClick={() => set(t)} className={cn(option, value === t && "font-semibold")}>
            <span className="flex-1 tabular-nums">{t || "None"}</span>{value === t ? <Check className="size-3.5 text-brand" /> : null}
          </button>
        ))}
      </div>
      {!dated ? <p className="px-1 text-xs text-faint">A time puts the task on today.</p> : null}
    </Pick>
  );
}
