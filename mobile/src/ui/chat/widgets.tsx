// The widgets the assistant's `show_*` tools hand back (core/widgets.ts is the contract): a day, a week, a review, a quote, a link
// and a lens preview, one fixed component per `type`. Display only: a task's box ticks through the same path as everywhere
// (cards.tsx `LiveTask`, a moment to take it back), a tap opens the note or task, and the one write, saving a proposed lens, is the
// owner's own button over the app's lens store. Not exported from the chat index, like cards.tsx: it needs the note and task screens.
import { Image } from "expo-image";
import { CalendarDays, ChartNoAxesColumn, Check, Globe, Quote, TriangleAlert, type LucideIcon } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { dayLabel } from "@/core/dates";
import { fold } from "@/core/notes";
import { lensProblem } from "@/core/lens";
import { previewPictureUrl } from "@/core/pocketbase";
import { dayDate, WEEKDAYS } from "@/core/planner";
import { accentColor, THEMES } from "@/core/theme";
import { localDay } from "@/core/time";
import { WIDGET_LIMITS, type DayWidget, type LensWidget, type LinkWidget, type QuoteWidget, type ReviewWidget, type WeekWidget, type Widget } from "@/core/widgets";
import { serverOf } from "@/store/keys";
import { saveLens, useLenses } from "@/store/lenses";
import { useNotes } from "@/store/notes";
import { usePrefs } from "@/store/prefs";
import { useTodo } from "@/store/todo";
import { Button, Chip, cn, Input, PressScale, T } from "../ds";
import { openLink, openNote } from "../note";
import { filterBy } from "../tags";
import { openTask } from "../tasks";
import { useTheme } from "../use-theme";
import { Cards, LiveTask, Surface } from "./cards";

/** The surface every widget but the quote and the link sits on: a title line (icon, words, what goes at its end) over its body. */
function Frame({ icon: Icon, title, aside, children }: { icon: LucideIcon; title: string; aside?: ReactNode; children: ReactNode }) {
  const { C } = useTheme();
  return (
    <View className="gap-3 rounded-2xl border border-line bg-raised p-3.5">
      <View className="flex-row items-center gap-2">
        <Icon size={16} color={C.dim} />
        <T font="semi" size={15} numberOfLines={1} className="flex-1">{title}</T>
        {aside}
      </View>
      {children}
    </View>
  );
}

const Quiet = ({ children }: { children: string }) => <T tone="dim" size={13}>{children}</T>;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

// ---- day

function Booked({ b, last }: { b: DayWidget["booked"][number]; last: boolean }) {
  const { C } = useTheme();
  return (
    <View className="flex-row gap-2.5">
      <View className="w-12 items-end pt-3">
        <T font="num" size={12}>{b.at}</T>
        <T font="num" size={11} tone="faint">{b.until}</T>
      </View>
      <View className="items-center">
        <View className="mt-4 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: b.clash ? C.warn : C.brand }} />
        {last ? null : <View className="w-px flex-1 bg-line" />}
      </View>
      <View className="flex-1 gap-1 pb-2">
        <LiveTask card={b.task} />
        {b.clash ? (
          <View className="flex-row items-center gap-1 px-1">
            <TriangleAlert size={12} color={C.warn} />
            <T tone="warn" font="semi" size={12}>Clashes with another task this hour</T>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function DayView({ w }: { w: DayWidget }) {
  const today = localDay(), empty = !w.booked.length && !w.unscheduled.length;
  return (
    <Frame icon={CalendarDays} title={dayLabel(w.date, today)} aside={w.done ? <Quiet>{`${w.done} done`}</Quiet> : undefined}>
      {empty ? <Quiet>Nothing planned.</Quiet> : null}
      {w.booked.length ? <View>{w.booked.map((b, i) => <Booked key={`${b.at}${b.task.id}`} b={b} last={i === w.booked.length - 1} />)}</View> : null}
      {w.unscheduled.length ? (
        <View className="gap-2">
          {w.booked.length ? <T variant="label">No hour</T> : null}
          <Cards cards={w.unscheduled} />
          {w.more ? <Quiet>{`+${w.more} more`}</Quiet> : null}
        </View>
      ) : null}
    </Frame>
  );
}

// ---- week

const CELL = 112;

/** A task's title in a day's cell; it opens the task when the phone has it. */
function Top({ t }: { t: { id: string; title: string } }) {
  const known = useTodo((s) => !!s.tasks[t.id]);
  return (
    <PressScale scaleTo={0.97} onPress={known ? () => openTask(t.id) : undefined} accessibilityRole="button" accessibilityLabel={t.title}
      accessibilityHint={known ? "Opens the task" : "No longer on this phone"} className={cn("rounded-md bg-muted px-1.5 py-1", !known && "opacity-60")}>
      <T size={12} numberOfLines={2}>{t.title}</T>
    </PressScale>
  );
}

function Cell({ d, today }: { d: WeekWidget["days"][number]; today: string }) {
  const { C } = useTheme();
  const here = d.date === today;
  return (
    <View className={cn("gap-1.5 rounded-xl border bg-card p-2.5", here ? "border-brand" : "border-line")} style={{ width: CELL }}>
      <View className="flex-row items-baseline justify-between">
        <T font="semi" size={12} tone={here ? "brand" : "dim"}>{WEEKDAYS[(dayDate(d.date).getDay() + 6) % 7]}</T>
        <T font="num-bold" size={15} tone={here ? "brand" : "fg"}>{dayDate(d.date).getDate()}</T>
      </View>
      {d.open ? (
        <View className="flex-row items-center gap-2">
          <T font="num-bold" size={20}>{d.open}</T>
          {d.booked ? (
            <View className="flex-row items-center gap-1">
              <View className="h-2 w-2 rounded-full bg-brand" />
              <T font="num" size={12} tone="dim">{d.booked}</T>
            </View>
          ) : null}
        </View>
      ) : <T tone="faint" size={13}>Free</T>}
      {d.overdue ? (
        <View className="flex-row items-center gap-1">
          <TriangleAlert size={12} color={C.warn} />
          <T tone="warn" font="semi" size={12}>{`${d.overdue} overdue`}</T>
        </View>
      ) : null}
      {d.top.map((t) => <Top key={t.id} t={t} />)}
    </View>
  );
}

function WeekView({ w }: { w: WeekWidget }) {
  const today = localDay();
  return (
    <Frame icon={CalendarDays} title={`Week of ${dayLabel(w.start, today)}`}>
      {/* Seven cells wider than the chat: scrolled sideways, like the Home strip */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2" nestedScrollEnabled>
        {w.days.map((d) => <Cell key={d.date} d={d} today={today} />)}
      </ScrollView>
    </Frame>
  );
}

// ---- review

const Tile = ({ n, label }: { n: number; label: string }) => (
  <View className="min-w-[44%] flex-1 gap-0.5 rounded-xl bg-card px-3 py-2.5">
    <T font="num-bold" size={24}>{n}</T>
    <T tone="dim" size={12}>{label}</T>
  </View>
);

function ReviewView({ w }: { w: ReviewWidget }) {
  const today = localDay(), more = w.stalledTotal - w.stalled.length;
  return (
    <Frame icon={ChartNoAxesColumn} title={`Last ${plural(w.days, "day")}`} aside={<Quiet>{`${dayLabel(w.from, today)} to ${dayLabel(w.to, today)}`}</Quiet>}>
      <View className="flex-row flex-wrap gap-2">
        <Tile n={w.done} label="Tasks done" />
        <Tile n={w.added} label="Tasks added" />
        <Tile n={w.notesAdded} label="Notes added" />
        <Tile n={w.notesEdited} label="Notes edited" />
      </View>
      {w.stalled.length ? (
        <View className="gap-2">
          <T variant="label">Stalled</T>
          {w.stalled.map(({ task, idle }) => (
            <View key={task.id} className="gap-1">
              <LiveTask card={task} />
              <T tone="warn" font="semi" size={12} className="px-1">{`Idle ${idle} d`}</T>
            </View>
          ))}
          {more > 0 ? <Quiet>{`+${more} more stalled`}</Quiet> : null}
        </View>
      ) : null}
      {w.tags.length ? (
        <View className="flex-row flex-wrap gap-2">
          {w.tags.map((t) => <Chip key={t.tag} size="sm" label={`${t.tag} ${t.count}`} onPress={() => filterBy(t.tag)} accessibilityLabel={`${t.tag}, ${plural(t.count, "item")}. Shows its notes`} />)}
        </View>
      ) : null}
    </Frame>
  );
}

// ---- quote

function QuoteView({ w }: { w: QuoteWidget }) {
  const { C } = useTheme();
  const there = useNotes((s) => !!s.notes[w.path]), title = w.title || useNotes.getState().notes[w.path]?.title || w.path;
  return (
    <Surface onOpen={() => openNote(w.path)} gone={!there} label={`${title}: ${w.quote}`} hint="Opens the note">
      <View className="gap-2 p-3.5">
        <View className="flex-row items-center gap-2">
          <Quote size={14} color={C.dim} />
          <T font="semi" size={14} numberOfLines={1} className="flex-1">{title}</T>
        </View>
        <View className="flex-row gap-2.5">
          <View className="w-0.5 rounded-full bg-brand" />
          <T tone="dim" size={14} className="flex-1 leading-5">
            {w.before ? `${w.before} ` : ""}
            <T font="semi" size={14} tone="fg" className="leading-5">{w.quote}</T>
            {w.after ? ` ${w.after}` : ""}
          </T>
        </View>
      </View>
    </Surface>
  );
}

// ---- link

function LinkView({ w }: { w: LinkWidget }) {
  const { C } = useTheme();
  const p = w.preview, s = serverOf(), picture = s ? previewPictureUrl(s, p, "sharp") : undefined;
  return (
    <Surface onOpen={() => openLink(p.url)} gone={false} label={p.title || p.url} hint="Opens the page">
      {picture ? <Image source={{ uri: picture }} contentFit="cover" cachePolicy="memory-disk" style={{ height: 140 }} accessibilityIgnoresInvertColors /> : null}
      <View className="gap-1 p-3.5">
        <View className="flex-row items-center gap-1.5">
          <Globe size={12} color={C.dim} />
          <T tone="dim" size={12} numberOfLines={1} className="shrink">{p.site || hostOf(p.url)}</T>
        </View>
        {p.title ? <T font="semi" size={15} numberOfLines={2} className="leading-5">{p.title}</T> : null}
        {p.description ? <T tone="dim" size={13} numberOfLines={3}>{p.description}</T> : null}
      </View>
    </Surface>
  );
}

function hostOf(url: string) {
  try { return new URL(url).host; } catch { return url; }
}

// ---- lens

const same = (a: readonly string[], b: readonly string[]) => a.map(fold).sort().join("\n") === b.map(fold).sort().join("\n");

function LensView({ w }: { w: LensWidget }) {
  const theme = useTheme(), own = usePrefs((s) => s.accent);
  const [name, setName] = useState(w.name ?? ""), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const kept = useLenses((s) => s.lenses.some((l) => fold(l.name) === fold(name.trim()) && same(l.tags, w.tags) && same(l.exclude, w.exclude)));
  const { accent } = w;
  const swatch = accentColor(THEMES[theme.name], accent ?? own);
  const fields = { name: name.trim(), tags: w.tags, exclude: w.exclude, accent: accent ?? null };
  const save = async () => {
    const problem = lensProblem(fields);
    if (problem) { setErr(problem); return; }
    setBusy(true); setErr(null);
    try { await saveLens(null, fields); } catch (e) { setErr(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(false); }
  };
  const sample = [...w.notes.sample.slice(0, WIDGET_LIMITS.top), ...w.tasks.sample.slice(0, WIDGET_LIMITS.top)];
  return (
    <View className="gap-3 rounded-2xl border border-line bg-raised p-3.5">
      <View className="flex-row items-center gap-2">
        <View className="h-4 w-4 rounded-full" style={{ backgroundColor: swatch }} />
        <T font="semi" size={15} numberOfLines={1} className="flex-1">{w.name || "A new lens"}</T>
      </View>
      <View className="flex-row flex-wrap gap-2">
        {w.tags.map((t) => <Chip key={t} size="sm" selected label={t} />)}
        {w.exclude.map((t) => <Chip key={`not ${t}`} size="sm" label={`not ${t}`} />)}
      </View>
      <T tone="dim" size={13} font="num">{`${plural(w.notes.count, "note")} · ${plural(w.tasks.count, "task")}`}</T>
      {sample.length ? <Cards cards={sample} /> : null}
      {w.name ? null : (
        <Input value={name} onChangeText={setName} placeholder="Name this lens" maxLength={40} accessibilityLabel="Lens name" />
      )}
      <View className="flex-row items-center gap-3">
        <Button size="sm" icon={kept ? Check : undefined} disabled={kept} loading={busy} onPress={() => void save()}>{kept ? "Saved" : "Save lens"}</Button>
        {err ? <T tone="warn" size={13} className="flex-1">{err}</T> : null}
      </View>
    </View>
  );
}

/** The component for a widget's `type`. */
export function WidgetView({ widget }: { widget: Widget }) {
  switch (widget.type) {
    case "day": return <DayView w={widget} />;
    case "week": return <WeekView w={widget} />;
    case "review": return <ReviewView w={widget} />;
    case "quote": return <QuoteView w={widget} />;
    case "link": return <LinkView w={widget} />;
    case "lens": return <LensView w={widget} />;
  }
}
