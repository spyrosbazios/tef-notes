// The notes and tasks the agent shows or leaves behind, as cards under its step. A card is drawn from the phone's
// own copy of the record when it has one, so a tick made elsewhere shows at once, and from the snapshot the tool returned
// when it hasn't; one whose record is gone is dimmed and opens nothing. A tap opens the record's screen, as a row in the
// lists does. The task's box ticks through the same store path as the Today list's (a moment to take it back, then the
// rev'd write). Not exported from the chat index: it needs the note and task screens' helpers, which import that index.
// `Surface` and `LiveTask` are widgets.tsx's too.
import { router } from "expo-router";
import { Bell, Calendar, Flag, ListChecks, Moon, Repeat } from "lucide-react-native";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { EnrichedMarkdownText } from "react-native-enriched-markdown";
import { cardKey, noteCardOf, taskCardOf, type Card, type NoteCard, type TaskCard } from "@/core/agent";
import { dayLabel, everyLabel, whenLabel } from "@/core/dates";
import { noteIdOf } from "@/core/notes";
import { dueLabel } from "@/core/things";
import { localDay } from "@/core/time";
import { useNotes, useNoteText } from "@/store/notes";
import { useTicking, toggleTask } from "@/store/ticks";
import { useTodo } from "@/store/todo";
import { cn, PressScale, T } from "../ds";
import { FLAGS, openLink, openNote, useMarkdownStyle } from "../note";
import { Box } from "../tasks";
import { TagBadge } from "../tags";
import { alpha } from "@/core/theme";
import { Photo } from "../thumb";
import { useTheme } from "../use-theme";

const LINE = 22, CLIP = LINE * 6;           // the preview's own height, a few lines; the rest fades out

/** A card's surface. `gone`: its record isn't on this phone, so it is dimmed and does nothing when tapped. */
export function Surface({ onOpen, gone, label, hint, children }: { onOpen: () => void; gone: boolean; label: string; hint: string; children: ReactNode }) {
  return (
    <PressScale onPress={gone ? undefined : onOpen} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={gone ? "No longer on this phone" : hint}
      className={cn("overflow-hidden rounded-2xl border border-line bg-card", gone && "opacity-60")} scaleTo={0.98}>
      {children}
    </PressScale>
  );
}

const Meta = ({ icon, children, tone = "dim", num }: { icon?: ReactNode; children: string; tone?: "dim" | "warn"; num?: boolean }) => (
  <View className="flex-row items-center gap-1">
    {icon}
    <T tone={tone} size={12} font={tone === "warn" ? "semi" : num ? "num" : "sans"} numberOfLines={1} className="shrink">{children}</T>
  </View>
);

// ---- note

function NoteView({ card, gone }: { card: NoteCard; gone: boolean }) {
  const { C } = useTheme();
  const md = useMarkdownStyle();
  const [full, setFull] = useState(0);                 // the preview's own height; past CLIP it fades out
  // A link in the preview takes the touch too (JS gets every touch, the native text's included): the tap that followed it is dropped
  const took = useRef(0);
  const open = () => { const at = Date.now(); setTimeout(() => { if (Math.abs(took.current - at) > 300) openNote(card.path); }, 120); };
  return (
    <Surface onOpen={open} gone={gone} label={card.title} hint="Opens the note">
      {card.image ? <Photo noteId={noteIdOf(card.path)} name={card.image} /> : null}
      <View className="gap-2 p-3.5">
        <T font="semi" size={15} numberOfLines={2} className="leading-5">{card.title}</T>
        {card.tags?.length ? (
          <View className="flex-row flex-wrap gap-1.5">
            {card.tags.slice(0, 4).map((t) => <TagBadge key={t} name={t} onPress={() => openNote(card.path)} />)}
          </View>
        ) : null}
        {card.preview ? (
          <View style={{ maxHeight: CLIP, overflow: "hidden" }}>
            <View onLayout={(e) => setFull(e.nativeEvent.layout.height)}>
              <EnrichedMarkdownText flavor="github" markdown={card.preview} markdownStyle={md} selectable={false} md4cFlags={FLAGS}
                enableTaskListItemToggle={false} onLinkPress={({ url }) => { took.current = Date.now(); openLink(url); }} />
            </View>
            {full > CLIP ? (
              <View pointerEvents="none" className="absolute bottom-0 left-0 right-0 h-10"
                style={{ experimental_backgroundImage: `linear-gradient(to bottom, ${alpha(C.card, 0)}, ${C.card})` }} />
            ) : null}
          </View>
        ) : null}
      </View>
    </Surface>
  );
}

function LiveNote({ card }: { card: NoteCard }) {
  const there = useNotes((s) => !!s.notes[card.path]), raw = useNoteText(card.path);      // null: indexed, but its text isn't here yet
  const live = useMemo(() => (raw == null ? card : noteCardOf(card.path, raw)), [raw, card]);
  return <NoteView card={live} gone={!there} />;
}

// ---- task

function TaskView({ card, ticking, tick, gone }: { card: TaskCard; ticking: boolean; tick?: () => void; gone: boolean }) {
  const { C } = useTheme();
  const today = localDay(), done = !!card.done || ticking;
  const when = whenLabel(card, today), due = card.due && !card.done ? dueLabel(card.due, today) : null;
  const meta = card.checklist || when || due || card.every || card.remind || card.done;
  return (
    <Surface onOpen={() => router.push({ pathname: "/task/[id]", params: { id: card.id } })} gone={gone} label={card.title} hint="Opens the task">
      <View className={cn("flex-row items-start gap-3.5 px-4 py-3", done && "opacity-50")}>
        <View className="mt-px"><Box done={done} onPress={tick ?? (() => {})} label={card.title} /></View>
        <View className="flex-1 gap-1">
          <T size={16} font="medium" style={done ? { color: C.dim, textDecorationLine: "line-through" } : undefined}>{card.title}</T>
          {meta ? (
            <View className="flex-row flex-wrap items-center gap-x-3 gap-y-0.5">
              {card.checklist ? <Meta num icon={<ListChecks size={11} color={C.dim} />}>{`${card.checklist[0]}/${card.checklist[1]}`}</Meta> : null}
              {when ? <Meta icon={card.evening ? <Moon size={11} color={C.dim} /> : <Calendar size={11} color={C.dim} />}>{when}</Meta> : null}
              {due ? <Meta tone="warn" icon={<Flag size={11} color={C.warn} />}>{due.text}</Meta> : null}
              {card.remind && !card.done ? <Meta num icon={<Bell size={11} color={C.dim} />}>{card.remind}</Meta> : null}
              {card.every && !card.done ? <Meta icon={<Repeat size={11} color={C.dim} />}>{everyLabel(card.every)}</Meta> : null}
              {card.done ? <Meta>{`Done ${dayLabel(card.done, today)}`}</Meta> : null}
            </View>
          ) : null}
        </View>
      </View>
    </Surface>
  );
}

export function LiveTask({ card }: { card: TaskCard }) {
  const local = useTodo((s) => s.tasks[card.id]);
  const ticking = useTicking((s) => !!s.ids[card.id]);
  const live = useMemo(() => (local ? taskCardOf(local) : card), [local, card]);
  return <TaskView card={live} ticking={ticking} tick={local ? () => toggleTask(card.id) : undefined} gone={!local} />;
}

/** The cards one after another, each drawn live where the phone has the record. */
export function Cards({ cards }: { cards: Card[] }) {
  return (
    <View className="gap-2">
      {cards.map((c) => c.kind === "note" ? <LiveNote key={cardKey(c)} card={c} />
        : <LiveTask key={cardKey(c)} card={c} />)}
    </View>
  );
}
