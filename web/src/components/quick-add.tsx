// New task: the whole card at once (title, notes, When, deadline, repeat, reminder, tags), started from where it was
// asked for: Today's + starts on Today, This Evening's in the evening, the Inbox's undated. Opened by Q anywhere the
// cursor isn't in a field, and by the + on a task list or a Home section.
import { useQueryClient } from "@tanstack/react-query";
import { Bell, Calendar, Flag, Moon, Repeat, Tag } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { dayLabel, whenLabel, type Schedule } from "@/core/dates";
import { MicButton } from "@/components/mic-button";
import { FormSheet, SheetForm } from "@/components/form-sheet";
import { TagEditor } from "@/components/tag-editor";
import { chip, Clear, RemindPicker, RepeatPicker, Row } from "@/components/task-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Turns } from "@/components/swap";
import { WhenPick, type WhenState } from "@/components/when-picker";
import { dictateInto } from "@/hooks/dictation";
import { useShake } from "@/hooks/shake";
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
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const [field, shake] = useShake<HTMLInputElement>();
  const notesBox = useRef<HTMLTextAreaElement>(null);
  const dismiss = useGuessedTags(title, notes, setTags);
  const state = stateOf(schedule, due), when = whenLabel(state, today);
  const pick = (s: Schedule | null) => { setSchedule(s); if (!s) setRemind(""); };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true); setFailed(false);
    try { await addTask(qc, { title, notes, ...scheduleOf(schedule), due: due ?? "", every, remind: schedule ? remind : "", tags }); onDone(); }
    catch (x) { toast.error(message(x)); setFailed(true); shake(); }
    finally { setBusy(false); }
  };
  const target = !schedule ? "Inbox" : schedule.when === today ? (schedule.evening ? "This Evening" : "Today") : when ?? "Upcoming";
  return (
    <SheetForm title="New task" onSubmit={add} className="space-y-4" actions={<>
      <Button type="button" variant="ghost" className="rounded-full" onClick={onDone}>Cancel</Button>
      <Button type="submit" className="rounded-full" disabled={busy || !title.trim()}><Turns aria-live="polite" state={busy ? "busy" : "idle"} states={{ idle: `Add to ${target}`, busy: "Adding…" }} /></Button>
    </>}>
      <div className="relative">
        <Input ref={field} autoFocus value={title} aria-invalid={failed || undefined} onChange={(e) => { setTitle(e.target.value); setFailed(false); }} placeholder="What needs doing? Type or tap the mic" aria-label="Task" className="h-11 pr-12 text-base" />
        <MicButton className="absolute top-1/2 right-1.5 -translate-y-1/2" onText={(t) => { setFailed(false); dictateInto(field.current, field.current?.value ?? title, t, setTitle); }} />
      </div>
      <div className="relative">
        <Textarea ref={notesBox} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" aria-label="Notes" className="min-h-20 pr-12 text-sm" />
        <MicButton className="absolute top-1.5 right-1.5" onText={(t) => dictateInto(notesBox.current, notesBox.current?.value ?? notes, t, setNotes)} />
      </div>
      <div className="space-y-0.5 border-t border-line pt-3">
        <Row icon={schedule?.evening ? Moon : Calendar} label="When">
          <WhenPick align="start" value={state} today={today} onSchedule={pick} onDue={setDue}>
            <button type="button" className={cn(chip, !when && "text-faint")}>{when ?? "No date"}</button>
          </WhenPick>
          {when ? <Clear label="Clear the date" onClick={() => pick(null)} /> : null}
        </Row>
        <Row icon={Flag} label="Deadline">
          <WhenPick align="start" value={state} today={today} onSchedule={pick} onDue={setDue}>
            <button type="button" className={cn(chip, due ? "text-warn" : "text-faint")}>{due ? dayLabel(due, today) : "None"}</button>
          </WhenPick>
          {due ? <Clear label="Clear the deadline" onClick={() => setDue(null)} /> : null}
        </Row>
        <Row icon={Repeat} label="Repeat"><RepeatPicker value={every} onChange={setEvery} /></Row>
        <Row icon={Bell} label="Reminder"><RemindPicker value={remind} dated={!!schedule} today={today} onChange={(f) => { setRemind(f.remind ?? ""); if (f.when) pick({ when: f.when, evening: false }); }} /></Row>
        <Row icon={Tag} label="Tags">
          <div className="flex min-w-0 flex-wrap items-center gap-1 py-1">
            <TagEditor tags={tags} onAdd={(t) => setTags((x) => (x.includes(t) ? x : [...x, t]))} onRemove={(t) => { dismiss(t); setTags((x) => x.filter((y) => y !== t)); }} />
          </div>
        </Row>
      </div>
    </SheetForm>
  );
}

/** `initial`: what a new task starts with (null: closed). The form is mounted per opening, so it starts clean. A dialog in a
 *  window, a bottom sheet below `md`, as the phone's add sheet is. */
export function QuickAdd({ initial, onClose }: { initial: Start | null; onClose: () => void }) {
  return <FormSheet open={!!initial} onClose={onClose} width="sm:max-w-lg">{initial ? <Form initial={initial} onDone={onClose} /> : null}</FormSheet>;
}
