// The Home tab's pieces (src/app/(tabs)/home.tsx): the task box (Today, the Inbox and Upcoming as quiet words, the
// chosen one in full; a tag filter and a + beside them; the list at a fixed height, frameless, scrolling inside, so the notes
// below always show) and the notes bar (count, tag filter, layout, sort, a + for a new note). The days over the box: ui/days.tsx. Colours from
// useTheme() (the accent is the brand), no entering animations (they misbehave here).
import { ArrowDownUp, CalendarDays, Check, Inbox, LayoutGrid, Moon, Plus, Star, Tags, type LucideIcon } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, View, type LayoutChangeEvent } from "react-native";
import { dayParts } from "@/core/dates";
import { inGroup } from "@/core/note-groups";
import { NOTE_SORT_LABEL, NOTE_SORTS, type NoteSort } from "@/core/note-sort";
import { fold } from "@/core/notes";
import type { Task, Views } from "@/core/todo";
import { useTicking } from "@/store/ticks";
import { useTodoViews } from "@/store/todo";
import { cn, IconButton, Sheet, T, Touchable } from "./ds";
import { TagFilter, type StripTag } from "./notes-header";
import { TaskList, type RowActions } from "./tasks";
import { useTheme } from "./use-theme";

/** The date, on one line, shrinking to fit. */
export const BOX_TABS = [
  { key: "today", label: "Today", icon: Star }, { key: "inbox", label: "Inbox", icon: Inbox }, { key: "upcoming", label: "Upcoming", icon: CalendarDays },
] as const satisfies readonly { key: string; label: string; icon: LucideIcon }[];
export type BoxTab = (typeof BOX_TABS)[number]["key"];
/** A day the strip picked, shown in Upcoming; `n` makes picking the same day again count. */
export type BoxFocus = { day: string; n: number };

const EMPTY: Record<BoxTab, string> = {
  today: "Nothing for today.",
  inbox: "Nothing waiting. New tasks land here.",
  upcoming: "Nothing scheduled ahead.",
};

/** Home's task box: its three lists as words over one list, the tag filter (any tag ticked, as the notes', over all three lists)
 *  and a + for a new task in the chosen one. `focus`: Upcoming scrolled to that day, or the next one with tasks, its heading lit.
 *  `onView`: the day whose section Upcoming was scrolled to by hand (the strip over the box follows it). */
export function TaskBox({ today, tab, onTab, focus, onView, actions, onAdd }: {
  today: string; tab: BoxTab; onTab: (tab: BoxTab) => void; focus: BoxFocus | null; onView: (day: string) => void; actions: RowActions; onAdd: () => void;
}) {
  const { C } = useTheme();
  const views = useTodoViews(today);
  const [tags, setTags] = useState<string[]>([]);

  const all = useMemo(() => [...views.today, ...views.evening, ...views.inbox, ...views.upcoming.flatMap((g) => g.tasks)], [views]);
  const filter = useMemo(() => {
    const m = new Map<string, StripTag>();
    for (const t of all) for (const g of t.tags) { const k = fold(g), c = m.get(k); m.set(k, { name: c?.name ?? g, count: (c?.count ?? 0) + 1 }); }
    const counted = [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    // a chosen tag no task carries now stays to be unchosen
    const missing = tags.filter((f) => f && !m.has(fold(f))).map((name) => ({ name, count: 0 }));
    return { tags: [...missing, ...counted], untagged: all.filter((t) => !t.tags.length).length };
  }, [all, tags]);

  return (
    <View>
      <View className="mx-4 flex-row items-center gap-2">
        <View className="min-w-0 flex-1 flex-row items-center gap-3.5" accessibilityRole="tablist">
          {BOX_TABS.map(({ key, label, icon: Icon }) => {
            const on = key === tab;
            return (
              <Pressable key={key} onPress={() => onTab(key)} accessibilityRole="tab" accessibilityState={{ selected: on }} hitSlop={8}
                className="flex-shrink flex-row items-center gap-1.5 active:opacity-60" style={on ? undefined : { opacity: 0.3 }}>
                {on ? <Icon size={17} color={C.brand} /> : null}
                <T font="heavy" size={17} numberOfLines={1}>{label}</T>
              </Pressable>
            );
          })}
        </View>
        <TagFilter what="tasks" bare tags={filter.tags} untagged={filter.untagged} value={tags} onChange={setTags} className="max-w-[30%]" />
        <IconButton compact label={`New task in ${BOX_TABS.find((t) => t.key === tab)?.label}`} icon={Plus} size={22} color={C.brand} onPress={onAdd} />
      </View>
      <BoxList key={tab} tab={tab} views={views} today={today} tags={tags} focus={tab === "upcoming" ? focus : null} onView={onView} actions={actions} />
    </View>
  );
}

/** A day's or This Evening's title over a hairline; `lit` when the strip picked it. */
function Heading({ title, detail, icon, lit }: { title: string; detail?: string; icon?: ReactNode; lit?: boolean }) {
  return (
    <View className={cn("mx-3 mb-1 mt-4 flex-row items-center gap-2 rounded-lg border-b border-line px-2 pb-2 pt-1", lit && "border-transparent bg-accent")}>
      {icon}
      <T font="heavy" size={15} tone={lit ? "brand" : "fg"}>{title}</T>
      {detail ? <T tone={lit ? "brand" : "dim"} size={12}>{detail}</T> : null}
    </View>
  );
}

/** One list of the box, mounted afresh per tab: its rows, scrolling inside a fixed height. */
function BoxList({ tab, views, today, tags, focus, onView, actions }: {
  tab: BoxTab; views: Views; today: string; tags: string[]; focus: BoxFocus | null; onView: (day: string) => void; actions: RowActions;
}) {
  const { C } = useTheme();
  const ticking = useTicking((s) => s.ids);
  const scroller = useRef<ScrollView>(null);
  const [more, setMore] = useState(false);                        // rows below the fold: the last visible ones fade
  const fold = useRef({ box: 0, content: 0, y: 0 });
  const measure = (m: Partial<typeof fold.current>) => {
    const f = Object.assign(fold.current, m);
    setMore(f.content - f.y - f.box > 4);
  };
  const tops = useRef(new Map<string, number>());                 // an Upcoming day's section, its offset in the list
  const wanted = useRef<string | null>(null);                     // a day to scroll to once its heading is laid out
  const byHand = useRef(false);                                   // a scroll the owner started (not one to a picked day)
  const viewed = useRef<string | null>(null);                     // the day last reported in view

  const shown = (ts: Task[]) => ts.filter((t) => inGroup(t.tags, tags));
  const upcoming = useMemo(() => views.upcoming.map((g) => ({ day: g.day, tasks: g.tasks.filter((t) => inGroup(t.tags, tags)) })).filter((g) => g.tasks.length),
    [views.upcoming, tags]);
  const lit = focus ? upcoming.find((g) => g.day >= focus.day)?.day : undefined;

  const scrollTo = (day: string) => {
    const y = tops.current.get(day);
    if (y == null) { wanted.current = day; return; }
    wanted.current = null;
    byHand.current = false;
    scroller.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
  };
  // The section under the top of the box while the owner scrolls Upcoming: reported once as it changes
  const view = (y: number) => {
    if (tab !== "upcoming" || !byHand.current) return;
    let day: string | null = null;
    for (const [d, top] of tops.current) if (top <= y + 24 && (!day || top > tops.current.get(day)!)) day = d;
    if (day && day !== viewed.current) { viewed.current = day; onView(day); }
  };
  useEffect(() => { if (focus && lit) scrollTo(lit); }, [focus, lit]);
  const placed = (day: string) => (e: LayoutChangeEvent) => { tops.current.set(day, e.nativeEvent.layout.y); if (wanted.current === day) scrollTo(day); };

  const rows = (ts: Task[]) => <TaskList tasks={ts} today={today} ticking={ticking} actions={actions} />;
  let body: ReactNode, count: number;
  if (tab === "today") {
    const day = shown(views.today), evening = shown(views.evening);
    count = day.length + evening.length;
    body = (
      <>
        {rows(day)}
        {evening.length ? <Heading title="This Evening" icon={<Moon size={15} color={C.brand} />} /> : null}
        {rows(evening)}
      </>
    );
  } else if (tab === "inbox") {
    const inbox = shown(views.inbox);
    count = inbox.length;
    body = rows(inbox);
  } else {
    count = upcoming.length;
    body = upcoming.map((g) => {
      const p = dayParts(g.day, today);
      return <View key={g.day} onLayout={placed(g.day)}><Heading title={p.label} detail={p.detail} lit={g.day === lit} />{rows(g.tasks)}</View>;
    });
  }

  return (
    <View className="relative mt-1 h-72">
      {count ? <ScrollView ref={scroller} nestedScrollEnabled showsVerticalScrollIndicator={false} contentContainerClassName="pb-2" scrollEventThrottle={32}
          onLayout={(e) => measure({ box: e.nativeEvent.layout.height })} onContentSizeChange={(_, h) => measure({ content: h })}
          onScrollBeginDrag={() => { byHand.current = true; }}
          onScroll={(e) => { measure({ y: e.nativeEvent.contentOffset.y }); view(e.nativeEvent.contentOffset.y); }}>{body}</ScrollView>
        : null}
      {count && more ? <View pointerEvents="none" className="absolute inset-x-0 bottom-0 h-14"
          style={{ experimental_backgroundImage: `linear-gradient(to bottom, transparent, ${C.bg})` }} /> : null}
      {count ? null
        : <T tone="faint" size={14} className="px-5 py-10 text-center">{tags.length ? "No task here carries those tags." : EMPTY[tab]}</T>}
    </View>
  );
}

/** Above Home's notes: their count, the tag filter, tiles or grouped by tag, the sort (a sheet of the four) and a + for a new note. */
export function NotesBar({ count, tags, untagged, filter, onFilter, grouped, onGrouped, sort, onSort, onAdd }: {
  count: number; tags: StripTag[]; untagged: number; filter: string[]; onFilter: (tags: string[]) => void;
  grouped: boolean; onGrouped: (on: boolean) => void; sort: NoteSort; onSort: (sort: NoteSort) => void; onAdd: () => void;
}) {
  const { C } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View className="mx-4 flex-row items-center gap-2">
      <T font="heavy" size={18}>Notes</T>
      <T tone="faint" font="num" size={13} className="flex-1">{count}</T>
      <TagFilter what="notes" tags={tags} untagged={untagged} value={filter} onChange={onFilter} className="max-w-[45%]" />
      <IconButton compact label={grouped ? "Show notes as tiles" : "Group notes by tag"} icon={grouped ? LayoutGrid : Tags} size={20} color={C.dim} onPress={() => onGrouped(!grouped)} />
      <IconButton compact label={`Sort notes: ${NOTE_SORT_LABEL[sort]}`} icon={ArrowDownUp} size={20} color={sort === "updated" ? C.dim : C.brand} onPress={() => setOpen(true)} />
      <IconButton compact label="New note" icon={Plus} size={22} color={C.brand} onPress={onAdd} />
      <Sheet open={open} onOpenChange={setOpen} title="Sort notes">
        <View className="gap-1 px-2 pb-4">
          {NOTE_SORTS.map((key) => (
            <Touchable key={key} onPress={() => { onSort(key); setOpen(false); }} accessibilityRole="radio" accessibilityState={{ selected: sort === key }}
              className="min-h-12 flex-row items-center gap-3 rounded-xl px-3">
              <T size={15} className="flex-1">{NOTE_SORT_LABEL[key]}</T>
              {sort === key ? <Check size={18} color={C.brand} /> : null}
            </Touchable>
          ))}
        </View>
      </Sheet>
    </View>
  );
}

