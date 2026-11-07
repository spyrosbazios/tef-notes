// The sheets over the task screens, one of each per screen, not per row: TaskSheet for a task's When, deadline, repeat,
// reminder and a note to link, opened by a swipe on a row or a row of the task's own screen,
// the delete question, and the quick add. Choices are core/things.ts's (whenFields, dueFields); a reminder is a time on the `when` day.
import * as Haptics from "expo-haptics";
import { Bell, BellOff, CalendarDays, CalendarX, Check, Flag, Moon, NotebookText, Plus, Repeat, Star, Sun, Sunrise, Tag, type LucideIcon } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { dayLabel, everyLabel, whenLabel } from "@/core/dates";
import { inheritTags } from "@/core/lens";
import { fold } from "@/core/notes";
import { notesOfTask } from "@/core/record-links";
import {
  dateOf, dayOf, dueFields, everyOf, REMIND_TIMES, REPEATS, UNITS, weekdaysOf, WEEKDAYS, whenFields, type DeadlineChoice, type WhenChoice,
} from "@/core/things";
import type { Task, TaskPatch } from "@/core/todo";
import { guessTags, tagGuesser } from "@/core/tags";
import { localDay } from "@/core/time";
import * as db from "@/store/db";
import { serverOf } from "@/store/keys";
import { useActiveLens } from "@/store/lenses";
import { useNoteList } from "@/store/notes";
import { useTodo } from "@/store/todo";
import { Action } from "./actions";
import { AlertDialog, Button, Calendar, Chip, Input, Sheet, T, Textarea } from "./ds";
import { TagDialog } from "./tag-dialog";
import { listTagTarget } from "./tag-targets";
import { TagsChip } from "./tags-chip";
import type { RowActions } from "./tasks";
import { useTheme } from "./use-theme";

const MONDAY = 1;

/** A month to pick a day from. `from`: the day it opens on. */
function Days({ from, onPick }: { from?: string | null; onPick: (day: string) => void }) {
  const start = from ? dateOf(from) : undefined;
  return <Calendar selected={start} defaultMonth={start} weekStartsOn={MONDAY} onSelect={(d) => onPick(dayOf(d))} />;
}

const Wrap = ({ children }: { children: ReactNode }) => <View className="flex-row flex-wrap gap-2 py-2">{children}</View>;

export type Kind = "when" | "deadline" | "repeat" | "remind" | "note";

/** A task's sheet; shut while `target` is null. Closing keeps the last one for the slide out. */
export type Target = { id: string; kind: Kind };

type Mode = "menu" | "date" | "time" | "custom";

/** The task fields the pickers read: a stored task, or the draft of a new one. */
type Draft = Pick<Task, "when" | "evening" | "due" | "every" | "remind">;
type Pickable = Exclude<Kind, "note">;

const TITLE: Record<Kind, string> = { when: "When", deadline: "Deadline", repeat: "Repeat", remind: "Remind me at", note: "Link a note" };

/** A sheet's title for a picker in a `mode`; `name`: what the When and Deadline menus are titled (the task's, or their own word). */
const pickerTitle = (kind: Kind, mode: Mode, name: string) =>
  kind === "when" && mode === "date" ? "Pick a day" : kind === "when" && mode === "time" ? "Remind me at" : kind === "deadline" && mode === "date" ? "Pick a deadline"
    : kind === "repeat" && mode === "custom" ? "Custom repeat" : kind === "when" || kind === "deadline" ? name : TITLE[kind];

/** The picker for one field, shared by a stored task's sheet and the new task's: `apply` takes the patch it makes. */
function Picker({ kind, mode, setMode, t, apply, today }: { kind: Pickable; mode: Mode; setMode: (m: Mode) => void; t: Draft; apply: Apply; today: string }) {
  const when = (c: WhenChoice) => apply(whenFields(c, today));
  const dead = (c: DeadlineChoice) => apply(dueFields(c, today));
  if (kind === "when") return mode === "date" ? <Days from={t.when} onPick={(day) => when({ day })} /> : <WhenMenu t={t} onChoose={when} onDate={() => setMode("date")} onRemind={() => setMode("time")} mode={mode} apply={apply} today={today} />;
  if (kind === "deadline") return mode === "date" ? <Days from={t.due} onPick={(day) => dead({ day })} /> : <DeadlineMenu t={t} onChoose={dead} onDate={() => setMode("date")} />;
  if (kind === "remind") return <Remind t={t} apply={apply} today={today} />;
  return mode === "custom" ? <Custom t={t} apply={apply} /> : <Repeats t={t} apply={apply} onCustom={() => setMode("custom")} />;
}

export function TaskSheet({ target, onClose }: { target: Target | null; onClose: () => void }) {
  const [held, setHeld] = useState(target);
  if (target && target !== held) setHeld(target);
  const live = useTodo((s) => (target ? s.tasks[target.id] : undefined));
  const [kept, setKept] = useState(live);
  if (live && live !== kept) setKept(live);
  const [mode, setMode] = useState<Mode>("menu");
  const shut = () => { onClose(); setMode("menu"); };
  const t = kept, kind = held?.kind ?? "when", today = localDay();
  const apply = (patch: TaskPatch) => { Haptics.selectionAsync(); if (target) useTodo.getState().update(target.id, patch); shut(); };

  const body = !t ? null : kind === "note" ? <NotePicker t={t} onDone={shut} /> : <Picker kind={kind} mode={mode} setMode={setMode} t={t} apply={apply} today={today} />;
  return (
    <Sheet open={!!target} onOpenChange={(o) => { if (!o) shut(); }} title={pickerTitle(kind, mode, t?.title ?? "")} scroll>{body}</Sheet>
  );
}

type Apply = (patch: TaskPatch) => void;

function WhenMenu({ t, onChoose, onDate, onRemind, mode, apply, today }: {
  t: Pick<Task, "when" | "remind">; onChoose: (c: WhenChoice) => void; onDate: () => void; onRemind: () => void; mode: Mode; apply: Apply; today: string;
}) {
  const { C } = useTheme();
  if (mode === "time") return <Remind t={t} apply={apply} today={today} />;
  return (
    <>
      <Action icon={<Star size={20} color={C.brand} />} label="Today" onPress={() => onChoose("today")} />
      <Action icon={<Moon size={20} color={C.dim} />} label="This Evening" onPress={() => onChoose("evening")} />
      <Action icon={<Sunrise size={20} color={C.dim} />} label="Tomorrow" onPress={() => onChoose("tomorrow")} />
      <Action icon={<CalendarDays size={20} color={C.dim} />} label="Pick a date" onPress={onDate} />
      <Action icon={t.remind ? <Bell size={20} color={C.brand} /> : <BellOff size={20} color={C.dim} />} label={t.remind ? `Reminder at ${t.remind}` : "Remind me at…"} onPress={onRemind} />
      {t.when ? <Action icon={<CalendarX size={20} color={C.dim} />} label="Clear" onPress={() => onChoose("clear")} /> : null}
    </>
  );
}

function DeadlineMenu({ t, onChoose, onDate }: { t: Pick<Task, "due">; onChoose: (c: DeadlineChoice) => void; onDate: () => void }) {
  const { C } = useTheme();
  return (
    <>
      <Action icon={<Flag size={20} color={C.warn} />} label="Today" onPress={() => onChoose("today")} />
      <Action icon={<Sun size={20} color={C.dim} />} label="Tomorrow" onPress={() => onChoose("tomorrow")} />
      <Action icon={<CalendarDays size={20} color={C.dim} />} label="Pick a date" onPress={onDate} />
      {t.due ? <Action icon={<CalendarX size={20} color={C.dim} />} label="Remove the deadline" onPress={() => onChoose("clear")} /> : null}
    </>
  );
}

/** Times on the `when` day; one on a task with no day sets it for today (a reminder needs its day). */
function Remind({ t, apply, today }: { t: Pick<Task, "when" | "remind">; apply: Apply; today: string }) {
  const { C } = useTheme();
  return (
    <>
      <Wrap>
        {REMIND_TIMES.map((r) => <Chip key={r} label={r} selected={t.remind === r} onPress={() => apply({ remind: r, ...(t.when ? {} : whenFields("today", today)) })} />)}
      </Wrap>
      {t.remind ? <Action icon={<BellOff size={20} color={C.dim} />} label="No reminder" onPress={() => apply({ remind: "" })} /> : null}
    </>
  );
}

function Repeats({ t, apply, onCustom }: { t: Pick<Task, "every">; apply: Apply; onCustom: () => void }) {
  const { C } = useTheme();
  const preset = REPEATS.some((r) => r.every === t.every);
  return (
    <>
      {REPEATS.map((r) => (
        <Action key={r.every} icon={t.every === r.every ? <Check size={20} color={C.brand} /> : <View style={{ width: 20 }} />} label={r.label} onPress={() => apply({ every: r.every })} />
      ))}
      <Action icon={t.every && !preset ? <Check size={20} color={C.brand} /> : <View style={{ width: 20 }} />} label={t.every && !preset ? `Custom: ${everyLabel(t.every)}` : "Custom…"} onPress={onCustom} />
      {t.every ? <Action icon={<CalendarX size={20} color={C.dim} />} label="Don't repeat" onPress={() => apply({ every: "" })} /> : null}
    </>
  );
}

/** Every N units (from the scheduled day, or from the day it was done), or on chosen weekdays. */
function Custom({ t, apply }: { t: Pick<Task, "every">; apply: Apply }) {
  const [n, setN] = useState("1");
  const [unit, setUnit] = useState<(typeof UNITS)[number]>("w");
  const [after, setAfter] = useState(t.every.startsWith("+"));
  const [days, setDays] = useState<string[]>(/^[a-z]/.test(t.every) ? t.every.split(",") : []);
  const toggle = (d: string) => setDays((l) => (l.includes(d) ? l.filter((x) => x !== d) : [...l, d]));
  const count = Number(n);
  const NAME = { d: "days", w: "weeks", m: "months", y: "years" } as const;
  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-3">
        <T tone="dim" size={13}>Every</T>
        <Input value={n} onChangeText={(v) => setN(v.replace(/\D/g, "").slice(0, 3))} keyboardType="number-pad" accessibilityLabel="How many" containerClassName="w-20" />
      </View>
      <Wrap>{UNITS.map((u) => <Chip key={u} label={NAME[u]} selected={unit === u} onPress={() => setUnit(u)} />)}</Wrap>
      <Wrap><Chip label="From the day it is done" selected={after} onPress={() => setAfter(!after)} /></Wrap>
      <Button disabled={!(count >= 1)} onPress={() => apply({ every: everyOf(count, unit, after) })}>Repeat every {count >= 1 ? count : "…"} {NAME[unit]}</Button>
      <T tone="dim" size={13} className="pt-2">Or on these days</T>
      <Wrap>{WEEKDAYS.map((d) => <Chip key={d} label={d[0].toUpperCase() + d.slice(1)} selected={days.includes(d)} onPress={() => toggle(d)} />)}</Wrap>
      <Button variant="tonal" disabled={!days.length} onPress={() => apply({ every: weekdaysOf(days) })}>Repeat on these days</Button>
    </View>
  );
}

/** A note to link the task to (a link `about`, core/record-links.ts): any on this phone that has reached the server (a link
 *  names it by its record). The task's linked notes are ticked; each is unlinked from the task's own screen. */
function NotePicker({ t, onDone }: { t: Task; onDone: () => void }) {
  const { C } = useTheme();
  const list = useNoteList();
  const linked = useTodo(useShallow((s) => notesOfTask(s.links, t.id)));
  const pick = (rec: string) => {
    if (!linked.includes(rec)) { Haptics.selectionAsync(); useTodo.getState().addLink({ type: "task", id: t.id }, { type: "note", id: rec }, "about"); }
    onDone();
  };
  const [q, setQ] = useState("");
  const f = fold(q.trim());
  const shown = list.filter((n) => !f || fold(n.title).includes(f)).flatMap((n) => { const rec = db.noteRec(n.path); return rec ? [{ n, rec }] : []; }).slice(0, 30);
  return (
    <View className="gap-2">
      <Input value={q} onChangeText={setQ} placeholder="Find a note" autoCapitalize="none" autoCorrect={false} accessibilityLabel="Find a note" />
      <View>
        {shown.map(({ n, rec }) => (
          <Action key={n.path} icon={linked.includes(rec) ? <Check size={20} color={C.brand} /> : <NotebookText size={20} color={C.dim} />} label={n.title} onPress={() => pick(rec)} />
        ))}
        {!shown.length ? <T tone="faint" size={13} className="py-2">No note found.</T> : null}
      </View>
    </View>
  );
}

// ---- quick add

/** One field of the new task: what it is and its value (dim when unset), opening that field's picker. */
function Field({ icon: Icon, label, value, tone, onPress }: { icon: LucideIcon; label: string; value: string | null; tone?: "warn"; onPress: () => void }) {
  const { C } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value ?? "none"}`} className="min-h-11 flex-row items-center gap-3 active:opacity-70">
      <Icon size={18} color={tone === "warn" && value ? C.warn : value ? C.brand : C.dim} />
      <T tone="dim" size={14} className="w-20">{label}</T>
      <T size={14} font="medium" tone={value ? (tone === "warn" ? "warn" : "fg") : "faint"} numberOfLines={1} className="flex-1">{value ?? "None"}</T>
    </Pressable>
  );
}

/** A new task, the whole card at once as on the web: a title and notes, then When (a Today, This Evening or later day), Deadline,
 *  Repeat, Reminder and Tags, each opening the picker a stored task's own screen uses, in this sheet's other pane; in the Inbox
 *  when it has no day. `start`: the When it opens on ("clear" the Inbox). Tags start as the lens's first (`useTodo.add` puts it on anyway). */
export function AddSheet({ open, start, onClose }: { open: boolean; start: WhenChoice; onClose: () => void }) {
  const { C } = useTheme();
  const [title, setTitle] = useState(""), [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tagged, setTagged] = useState<string[] | null>(null);
  const [kind, setKind] = useState<Pickable | null>(null), [mode, setMode] = useState<Mode>("menu"), [picking, setPicking] = useState(false);
  const today = localDay(), lens = useActiveLens();
  const d: Draft = draft ?? { every: "", due: "", remind: "", ...whenFields(start, today) } as Draft;
  const tags = tagged ?? inheritTags(lens);
  // The server guesses the tags while the title and notes are typed; one guesser per opening, stopped when it shuts
  const fill = useCallback((next: (t: string[]) => string[]) => setTagged((t) => next(t ?? inheritTags(lens))), [lens]);
  const guesser = useMemo(() => {
    const s = serverOf();
    return open && s ? tagGuesser((draft, signal) => guessTags(s, draft, signal), fill) : null;
  }, [open, fill]);
  useEffect(() => guesser?.update(title, notes), [guesser, title, notes]);
  useEffect(() => () => guesser?.stop(), [guesser]);
  const shut = () => { setTitle(""); setNotes(""); setDraft(null); setTagged(null); setKind(null); setMode("menu"); onClose(); };
  const add = () => {
    if (!title.trim()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    useTodo.getState().add({ title, ...(notes.trim() ? { notes } : {}), ...d, tags });
    shut();
  };
  const show = (k: Pickable) => { Haptics.selectionAsync(); setKind(k); setMode("menu"); };
  const apply = (patch: TaskPatch) => { Haptics.selectionAsync(); setDraft({ ...d, ...patch }); setKind(null); setMode("menu"); };
  const back = () => { if (mode === "menu") setKind(null); else setMode("menu"); };
  const when = whenLabel(d, today), dead = d.due ? dayLabel(d.due, today) : null;
  const target = listTagTarget("Tags", tags, (next) => {
    for (const t of tags) if (!next.some((n) => fold(n) === fold(t))) guesser?.dismiss(t);
    setTagged(next);
  });
  const place = !d.when ? "Inbox" : when ?? "Upcoming";

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => { if (!o) shut(); }} title={kind ? pickerTitle(kind, mode, kind === "when" ? "When" : "Deadline") : "New task"} scroll
        right={kind ? <Button size="sm" variant="ghost" onPress={back}>Back</Button> : undefined}>
        {kind ? <Picker kind={kind} mode={mode} setMode={setMode} t={d} apply={apply} today={today} /> : (
          <View className="gap-3">
            <Input value={title} onChangeText={setTitle} onSubmitEditing={add} placeholder="What needs doing?" autoFocus returnKeyType="done" submitBehavior="submit"
              accessibilityLabel="Task title" />
            <Textarea value={notes} onChangeText={setNotes} placeholder="Notes" accessibilityLabel="Notes" className="min-h-16" />
            <View>
              <Field icon={d.evening ? Moon : CalendarDays} label="When" value={when} onPress={() => show("when")} />
              <Field icon={Flag} label="Deadline" value={dead} tone="warn" onPress={() => show("deadline")} />
              <Field icon={Repeat} label="Repeat" value={d.every ? everyLabel(d.every) : null} onPress={() => show("repeat")} />
              <Field icon={Bell} label="Reminder" value={d.remind || null} onPress={() => show("remind")} />
              <View className="min-h-11 flex-row items-center gap-3">
                <Tag size={18} color={tags.length ? C.brand : C.dim} />
                <T tone="dim" size={14} className="w-20">Tags</T>
                <TagsChip tags={tags} onPress={() => setPicking(true)} />
              </View>
            </View>
            <Button icon={Plus} onPress={add} disabled={!title.trim()}>{`Add to ${place}`}</Button>
          </View>
        )}
      </Sheet>
      <TagDialog target={target} open={open && picking} onClose={() => setPicking(false)} />
    </>
  );
}

/** What a row's swipes and the screen's own buttons ask of a task: its When sheet, and the question before
 *  a delete (`onDeleted` runs after it: the task's own screen leaves). A screen puts `dialogs` in its tree once and hands
 *  `actions` to its rows. */
export function useTaskActions(onDeleted?: () => void) {
  const [sheet, setSheet] = useState<Target | null>(null);
  const [asking, setAsking] = useState<Task | null>(null);
  const [open, setOpen] = useState(false);
  const actions = useMemo<RowActions>(() => ({
    onWhen: (t) => setSheet({ id: t.id, kind: "when" }),
    onDelete: (t) => { setAsking(t); setOpen(true); },
  }), []);
  const dialogs = (
    <>
      <TaskSheet target={sheet} onClose={() => setSheet(null)} />
      <AlertDialog open={open} onOpenChange={setOpen} title={asking?.title ?? ""} action="Delete" destructive
        description="Delete this task? It goes from the server too on the next sync, and nothing keeps a copy."
        onAction={() => {
          if (asking) { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); useTodo.getState().remove(asking.id); }
          setOpen(false);
          onDeleted?.();
        }} />
    </>
  );
  return { actions, dialogs, openSheet: setSheet };
}
