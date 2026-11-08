// New task: the whole card at once (title, notes, When, deadline, repeat, reminder, tags), started from where it was
// asked for: Today's + starts on Today, This Evening's in the evening, the Inbox's undated. Opened by Q anywhere the
// cursor isn't in a field, and by the + on a task list or a Home section.
import { useQueryClient } from "@tanstack/react-query";
import { Bell, Calendar, Flag, Moon, Repeat, Tag } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { dayLabel, whenLabel, type Schedule } from "@/core/dates";
import { InSheet } from "@/components/pick";
import { TagEditor } from "@/components/tag-editor";
import { chip, Clear, RemindPicker, RepeatPicker, Row } from "@/components/task-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Turns } from "@/components/swap";
import { WhenPick, type WhenState } from "@/components/when-picker";
import { useNarrow } from "@/hooks/media";
import { useShake } from "@/hooks/shake";
import { useGuessedTags } from "@/hooks/tags";
import { addTask, useToday } from "@/hooks/todo";
import { scheduleOf } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import { message } from "@/services/api";

/** What a new task starts with: the list it was added from. */
export type Start = { schedule: Schedule | null };

const stateOf = (s: Schedule | null, due: string | null): WhenState => ({ when: s?.when ?? null, evening: !!s?.evening, due });

function Form({ initial, narrow, onDone }: { initial: Start; narrow: boolean; onDone: () => void }) {
  const qc = useQueryClient(), today = useToday();
  const [title, setTitle] = useState(""), [notes, setNotes] = useState("");
  const [schedule, setSchedule] = useState<Schedule | null>(initial.schedule), [due, setDue] = useState<string | null>(null);
  const [every, setEvery] = useState(""), [remind, setRemind] = useState(""), [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const [field, shake] = useShake<HTMLInputElement>();
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
    <form onSubmit={add} className="space-y-4">
      {narrow ? <DrawerTitle className="text-center text-[15px] font-semibold">New task</DrawerTitle> : <DialogHeader><DialogTitle>New task</DialogTitle></DialogHeader>}
      <Input ref={field} autoFocus value={title} aria-invalid={failed || undefined} onChange={(e) => { setTitle(e.target.value); setFailed(false); }} placeholder="What needs doing?" aria-label="Task" className="h-11 text-base" />
      <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" aria-label="Notes" className="min-h-20 text-sm" />
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
      <DialogFooter>
        <Button type="button" variant="ghost" className="rounded-full" onClick={onDone}>Cancel</Button>
        <Button type="submit" className="rounded-full" disabled={busy || !title.trim()}><Turns aria-live="polite" state={busy ? "busy" : "idle"} states={{ idle: `Add to ${target}`, busy: "Adding…" }} /></Button>
      </DialogFooter>
    </form>
  );
}

/** `initial`: what a new task starts with (null: closed). The form is mounted per opening, so it starts clean. A dialog in a
 *  window, a bottom sheet below `md`, as the phone's add sheet is. */
export function QuickAdd({ initial, onClose }: { initial: Start | null; onClose: () => void }) {
  const narrow = useNarrow();
  const change = (o: boolean) => { if (!o) onClose(); };
  if (narrow) {
    return (
      <Drawer open={!!initial} onOpenChange={change}>
        <DrawerContent className="data-[vaul-drawer-direction=bottom]:max-h-[92dvh]">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <InSheet value>{initial ? <Form initial={initial} narrow onDone={onClose} /> : null}</InSheet>
          </div>
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Dialog open={!!initial} onOpenChange={change}>
      <DialogContent className="sm:max-w-lg">{initial ? <Form initial={initial} narrow={false} onDone={onClose} /> : null}</DialogContent>
    </Dialog>
  );
}
