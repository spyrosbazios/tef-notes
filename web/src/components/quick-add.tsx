// New task: the whole card at once (title, notes, When, deadline, repeat, reminder, tags), started from where it was
// asked for: Today's + starts on Today, This Evening's in the evening, the Inbox's undated. Opened by Q anywhere the
// cursor isn't in a field, and by the + on a task list or a Home section.
import { useQueryClient } from "@tanstack/react-query";
import { Bell, Calendar, Flag, Moon, Repeat, Tag } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { dayLabel, whenLabel, type Schedule } from "@/core/dates";
import { TagEditor } from "@/components/tag-editor";
import { chip, Clear, RemindPicker, RepeatPicker, Row } from "@/components/task-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { WhenPopover, type WhenState } from "@/components/when-picker";
import { useGuessedTags } from "@/hooks/tags";
import { addTask, useToday } from "@/hooks/todo";
import { scheduleOf } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import { message } from "@/services/api";

/** What a new task starts with: the list it was added from. */
export type Start = { schedule: Schedule | null };

const stateOf = (s: Schedule | null, due: string | null): WhenState => ({ when: s?.when ?? null, evening: !!s?.evening, due });

function Form({ initial, onDone }: { initial: Start; onDone: () => void }) {
  const qc = useQueryClient(), today = useToday();
  const [title, setTitle] = useState(""), [notes, setNotes] = useState("");
  const [schedule, setSchedule] = useState<Schedule | null>(initial.schedule), [due, setDue] = useState<string | null>(null);
  const [every, setEvery] = useState(""), [remind, setRemind] = useState(""), [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const dismiss = useGuessedTags(title, notes, setTags);
  const state = stateOf(schedule, due), when = whenLabel(state, today);
  const pick = (s: Schedule | null) => { setSchedule(s); if (!s) setRemind(""); };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try { await addTask(qc, { title, notes, ...scheduleOf(schedule), due: due ?? "", every, remind: schedule ? remind : "", tags }); onDone(); }
    catch (x) { toast.error(message(x)); }
    finally { setBusy(false); }
  };
  const target = !schedule ? "Inbox" : schedule.when === today ? (schedule.evening ? "This Evening" : "Today") : when ?? "Upcoming";
  return (
    <form onSubmit={add} className="space-y-4">
      <DialogHeader><DialogTitle>New task</DialogTitle></DialogHeader>
      <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" aria-label="Task" className="h-11 text-base" />
      <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" aria-label="Notes" className="min-h-20 text-sm" />
      <div className="space-y-0.5 border-t border-line pt-3">
        <Row icon={schedule?.evening ? Moon : Calendar} label="When">
          <WhenPopover align="start" value={state} today={today} onSchedule={pick} onDue={setDue}>
            <button type="button" className={cn(chip, !when && "text-faint")}>{when ?? "No date"}</button>
          </WhenPopover>
          {when ? <Clear label="Clear the date" onClick={() => pick(null)} /> : null}
        </Row>
        <Row icon={Flag} label="Deadline">
          <WhenPopover align="start" value={state} today={today} onSchedule={pick} onDue={setDue}>
            <button type="button" className={cn(chip, due ? "text-warn" : "text-faint")}>{due ? dayLabel(due, today) : "None"}</button>
          </WhenPopover>
          {due ? <Clear label="Clear the deadline" onClick={() => setDue(null)} /> : null}
        </Row>
        <Row icon={Repeat} label="Repeat"><RepeatPicker value={every} onChange={setEvery} /></Row>
        <Row icon={Bell} label="Reminder"><RemindPicker value={remind} dated={!!schedule} onChange={setRemind} /></Row>
        <Row icon={Tag} label="Tags">
          <div className="flex min-w-0 flex-wrap items-center gap-1 py-1">
            <TagEditor tags={tags} onAdd={(t) => setTags((x) => (x.includes(t) ? x : [...x, t]))} onRemove={(t) => { dismiss(t); setTags((x) => x.filter((y) => y !== t)); }} />
          </div>
        </Row>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" className="rounded-full" onClick={onDone}>Cancel</Button>
        <Button type="submit" className="rounded-full" disabled={busy || !title.trim()}>{busy ? "Adding…" : `Add to ${target}`}</Button>
      </DialogFooter>
    </form>
  );
}

/** `initial`: what a new task starts with (null: closed). The form is mounted per opening, so it starts clean. */
export function QuickAdd({ initial, onClose }: { initial: Start | null; onClose: () => void }) {
  return (
    <Dialog open={!!initial} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">{initial ? <Form initial={initial} onDone={onClose} /> : null}</DialogContent>
    </Dialog>
  );
}
