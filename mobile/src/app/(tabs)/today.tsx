// The Tasks tab (route `today`), Things-style, opening at Today or at the list its `list` param names (openTaskList): what is for today, then this evening, with a row of tabs to the other lists: the Inbox, Upcoming
// (by day) and the Logbook. The large title folds into the bar as
// the list scrolls; the tabs stay put. Each list is a page of a pager: a swipe pages between them, the tabs' underline
// following the finger, every page keeping its own scroll (the large title folds by the page in view, blended while
// swiping). Tasks are records (core/todo.ts, store/todo.ts); the + adds one, for today on Today and to the Inbox
// elsewhere. Rows, their swipes and the drag to reorder: ui/tasks.tsx; the sheets and the delete question:
// ui/task-sheets.tsx.
import { router, useLocalSearchParams } from "expo-router";
import { CalendarCheck, CalendarDays, CircleCheck, Inbox, Moon, Plus, type LucideIcon } from "lucide-react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshControl, View } from "react-native";
import { ScrollViewContainer } from "react-native-reorderable-list";
import { useAnimatedReaction, useAnimatedScrollHandler, useDerivedValue, useSharedValue, type SharedValue } from "react-native-reanimated";
import { dayParts } from "@/core/dates";
import type { Task } from "@/core/todo";
import { localDay } from "@/core/time";
import { useAssistant } from "@/store/assistant";
import { syncNotes } from "@/store/notes";
import { useTicking } from "@/store/ticks";
import { syncTodo, useTodoViews } from "@/store/todo";
import { useNow } from "@/ui/fmt";
import { alpha } from "@/core/theme";
import { EmptyState, Fab, Pager, ScreenHeader, Tabs, T, usePagerPosition, type Option, type PagerRef } from "@/ui/ds";
import { TASK_LISTS, TaskList, type TaskListKey } from "@/ui/tasks";
import { AddSheet, useTaskActions } from "@/ui/task-sheets";
import { useTheme } from "@/ui/use-theme";

const LISTS = TASK_LISTS;
type List = TaskListKey;
const START = LISTS.findIndex((l) => l.key === "today");
/** The page a `list` param names (openTaskList), if it names one. */
const pageOf = (list: string | undefined) => { const i = LISTS.findIndex((l) => l.key === list); return i < 0 ? undefined : i; };

const EMPTY: Record<List, { icon: LucideIcon; title: string; hint: string }> = {
  today: { icon: CalendarCheck, title: "Nothing for today", hint: "Tasks you give today's date land here." },
  upcoming: { icon: CalendarDays, title: "Nothing scheduled ahead", hint: "Give a task a day and it waits here." },
  inbox: { icon: Inbox, title: "The Inbox is empty", hint: "New tasks land here until you place them." },
  logbook: { icon: CircleCheck, title: "Nothing ticked off yet", hint: "Finished tasks are kept here." },
};
const LOGBOOK = 100;

/** A section's title over a hairline: This Evening, a day. */
const Section = ({ icon, title, detail }: { icon?: ReactNode; title: string; detail?: string }) => (
  <View className="mx-5 mb-1 mt-6 flex-row items-center gap-2 border-b border-line pb-2">
    {icon}
    <T font="heavy" size={15}>{title}</T>
    {detail ? <T tone="dim" size={12}>{detail}</T> : null}
  </View>
);

/** The right edge of the tabs fading out: more of them are off the screen. */
function EdgeFade() {
  const { C } = useTheme();
  return (
    <View pointerEvents="none" className="absolute inset-y-0 right-0 w-8 flex-row">
      {[0.1, 0.25, 0.45, 0.7, 0.9, 1].map((a, i) => <View key={i} className="flex-1" style={{ backgroundColor: alpha(C.bg, a) }} />)}
    </View>
  );
}

/** One list's page: its own scroll (and pull to refresh), reporting its offset into `offsets[index]` for the header to fold by.
 *  Its rows' swipes (ReanimatedSwipeable, 10 dp to claim) start before the pager's own paging slop (twice the platform touch
 *  slop, 16 dp), so a horizontal drag that begins on a task row swipes the row and the long press picks it up; a drag that
 *  begins anywhere else on the page (a gap, a section title, the empty space) pages. */
function Page({ index, offsets, pulling, onRefresh, children }: { index: number; offsets: SharedValue<number[]>; pulling: boolean; onRefresh: () => void; children: ReactNode }) {
  const { C } = useTheme();
  const onScroll = useAnimatedScrollHandler((e) => {
    offsets.modify((o) => { "worklet"; o[index] = e.contentOffset.y; return o; });
  });
  return (
    <ScrollViewContainer onScroll={onScroll} contentContainerStyle={{ paddingBottom: 120, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} colors={[C.brand]} tintColor={C.brand} progressBackgroundColor={C.raised} />}>
      {children}
    </ScrollViewContainer>
  );
}

export default function Today() {
  const { C } = useTheme();
  const now = useNow(60_000), today = localDay(now);
  const views = useTodoViews(today);
  const ticking = useTicking((s) => s.ids);
  const { actions, dialogs } = useTaskActions();
  const pager = useRef<PagerRef>(null);
  // Opened at a list (Home's chips: openTaskList), else at Today
  const asked = useLocalSearchParams<{ list?: string }>().list;
  const [first] = useState(() => pageOf(asked) ?? START);
  const [index, setIndex] = useState(first);
  const [seen, setSeen] = useState<ReadonlySet<number>>(() => new Set([first - 1, first, first + 1]));
  const [adding, setAdding] = useState(false);
  const [pulling, setPulling] = useState(false);
  const list = LISTS[index].key;
  // The page in view is the assistant's context ("this list"); off this tab it means nothing
  useEffect(() => { useAssistant.setState({ list }); return () => useAssistant.setState({ list: null }); }, [list]);

  // The pager's position (fractional) and each page's scroll offset: the tabs' underline follows the first, the large title
  // folds by the second, blended between the two pages in view
  const position = useSharedValue(first);
  const offsets = useSharedValue<number[]>(LISTS.map(() => 0));
  const scrollY = useSharedValue(0);
  const onPageScroll = usePagerPosition(position);
  // The date under the title is Today's: it fades as the swipe leaves Today, its room kept so the header holds still
  const dateShown = useDerivedValue(() => Math.max(0, 1 - Math.abs(position.value - START)));
  useAnimatedReaction(() => {
    const p = position.value, o = offsets.value;
    const i = Math.min(Math.max(Math.floor(p), 0), o.length - 1), j = Math.min(i + 1, o.length - 1);
    return o[i] + (o[j] - o[i]) * (p - i);
  }, (y) => { scrollY.value = y; });

  // A page's content is built once it is in view or next to it, and kept (with its scroll) after
  const reach = (i: number) => setSeen((s) => (s.has(i - 1) && s.has(i) && s.has(i + 1) ? s : new Set([...s, i - 1, i, i + 1])));
  const goto = (k: List) => {
    const i = LISTS.findIndex((l) => l.key === k);
    reach(i);
    setIndex(i);
    // A neighbour slides in; a far one jumps, rather than flash by pages that aren't built yet
    if (Math.abs(i - index) === 1) pager.current?.setPage(i); else pager.current?.setPageWithoutAnimation(i);
  };
  // Asked again while the tab is mounted: that page is built and current from this render, the pager jumps to it, and the
  // param is cleared so the same chip works next time
  const [took, setTook] = useState(asked);
  if (asked !== took) {
    setTook(asked);
    const i = pageOf(asked);
    if (i != null) { reach(i); setIndex(i); }
  }
  useEffect(() => {
    if (!asked) return;
    const i = pageOf(asked);
    if (i != null) pager.current?.setPageWithoutAnimation(i);
    router.setParams({ list: undefined });
  }, [asked]);
  const refresh = () => { setPulling(true); Promise.all([syncTodo(), syncNotes()]).finally(() => setPulling(false)); };

  const rows = (ts: Task[], opts: { reorderable?: boolean } = {}) => (
    <TaskList tasks={ts} today={today} ticking={ticking} actions={actions} reorderable={opts.reorderable} />
  );

  /** A list's rows, and whether it has none. */
  const content = (list: List): { body: ReactNode; empty: boolean } => {
  let body: ReactNode, empty: boolean;
  if (list === "today") {
    empty = !views.today.length && !views.evening.length;
    body = (
      <>
        {rows(views.today, { reorderable: true })}
        {views.evening.length ? <Section icon={<Moon size={15} color={C.brand} />} title="This Evening" /> : null}
        {rows(views.evening, { reorderable: true })}
      </>
    );
  } else if (list === "inbox") {
    empty = !views.inbox.length;
    body = rows(views.inbox, { reorderable: true });
  } else if (list === "upcoming") {
    empty = !views.upcoming.length;
    body = views.upcoming.map((g) => {
      const p = dayParts(g.day, today);
      return <View key={g.day}><Section title={p.label} detail={p.detail} />{rows(g.tasks)}</View>;
    });
  } else {
    empty = !views[list].length;
    body = rows(views[list].slice(0, LOGBOOK));
  }
  return { body, empty };
  };
  const title = LISTS[index].label;
  const options: Option<List>[] = LISTS.map((l) => ({
    ...l, count: l.key === "inbox" ? views.inbox.length : l.key === "today" ? views.today.length + views.evening.length : undefined,
  }));

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title={title} scrollY={scrollY}
        subtitle={new Date(now).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} subtitleShown={dateShown}>
        <View>
          <Tabs options={options} value={list} position={position} onChange={goto} />
          <EdgeFade />
        </View>
        <View className="h-px bg-line" />
      </ScreenHeader>
      <Pager ref={pager} style={{ flex: 1 }} initialPage={first} offscreenPageLimit={1} onPageScroll={onPageScroll}
        onPageSelected={(e) => { const i = e.nativeEvent.position; reach(i); setIndex(i); }}>
        {LISTS.map((l, i) => {
          const page = seen.has(i) ? content(l.key) : null;
          const hint = EMPTY[l.key];
          return (
            <View key={l.key} collapsable={false}>
              {page ? (
                <Page index={i} offsets={offsets} pulling={pulling} onRefresh={refresh}>
                  {page.body}
                  {page.empty ? <EmptyState icon={hint.icon} title={hint.title} hint={hint.hint} className="pt-20" /> : null}
                </Page>
              ) : null}
            </View>
          );
        })}
      </Pager>
      <Fab icon={Plus} label="New task" onPress={() => setAdding(true)} />
      {dialogs}
      <AddSheet open={adding} start={list === "today" ? "today" : "clear"} onClose={() => setAdding(false)} />
    </View>
  );
}
