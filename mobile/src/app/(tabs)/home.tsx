// Home, the first tab: the day at a glance, then every note, as the web's Home. The header: the app's mark, which is the lens
// (ui/lens.tsx: picked here only, its tags filter everything here and on every other tab), and Search, which opens as a drawer under
// it and shows its results in place of the page (ui/search.tsx). The assistant and Settings are tabs.
// Then the days (ui/days.tsx, the web's month planner as a strip scrolled past a fixed slot): the day in the slot shows in the
// box, dragged or tapped there, and Upcoming scrolled by hand slides the strip to the day in view; a long press adds a task that day. Then the task box: Today, the Inbox and Upcoming as quiet words over one list at a fixed height that
// scrolls inside the page, so the notes always show, with a tag filter and a + (ticks and swipes as the Tasks tab's rows).
// Then every note as tiles in two columns, a page at a time: a tag filter, the grouped-by-tag view (`notesView`,
// `notesTags` and `collapsedTags` prefs), the sort (`notesSort`) and a + for a new note, in the notes' own header. A long press selects a note
// and the selection bar covers the top. The pieces: ui/home.tsx.
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { NotebookPen, Search, SearchX, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, LayoutAnimation, RefreshControl, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { toggled } from "@/core/bulk";
import { flipped, groupNotes, inGroup, NO_TAG } from "@/core/note-groups";
import { sortNotes } from "@/core/note-sort";
import { fold } from "@/core/notes";
import { allTagNames } from "@/core/tags";
import type { WhenChoice } from "@/core/things";
import { localDay } from "@/core/time";
import { useActiveLens } from "@/store/lenses";
import { syncNotes, useNoteList, useNotes, type NoteMeta } from "@/store/notes";
import { usePrefs } from "@/store/prefs";
import { useTags } from "@/store/tags";
import { syncTodo } from "@/store/todo";
import { EmptyState, IconButton } from "@/ui/ds";
import { useNow } from "@/ui/fmt";
import { NotesBar, TaskBox, type BoxFocus, type BoxTab } from "@/ui/home";
import { SearchDrawer } from "@/ui/search";
import { LensSwitcher } from "@/ui/lens";
import { newNote, openNote } from "@/ui/note";
import { GroupedNotes, type GroupRow } from "@/ui/note-groups";
import { NoteTile } from "@/ui/note-tile";
import { SelectionBar } from "@/ui/selection";
import { AddSheet, useTaskActions } from "@/ui/task-sheets";
import { useTheme } from "@/ui/use-theme";
import { Days } from "@/ui/days";

const PAGE = 30;
const key = (n: NoteMeta) => n.path;

export default function Home() {
  const { C } = useTheme();
  const insets = useSafeAreaInsets();
  const now = useNow(60_000), today = localDay(now);
  const lens = useActiveLens();
  const local = useNotes((s) => s.sync.state === "off");

  // Tasks, inside the lens that is on: the box's list, and the day the strip holds for it
  const { actions, dialogs } = useTaskActions();
  const [adding, setAdding] = useState<WhenChoice | null>(null);
  const [tab, setTab] = useState<BoxTab>("today");
  const [focus, setFocus] = useState<BoxFocus | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);        // the day Upcoming was scrolled to by hand; the strip follows it
  const boxTop = useRef(0), scrolled = useRef(0);

  const notes = useNoteList();
  const filters = usePrefs((s) => s.notesTags), view = usePrefs((s) => s.notesView), collapsed = usePrefs((s) => s.collapsedTags);
  const grouped = view === "tags";
  const sort = usePrefs((s) => s.notesSort);
  const [limit, setLimit] = useState(PAGE);
  const [sel, setSel] = useState<string[]>([]);
  const [pulling, setPulling] = useState(false);
  const [searching, setSearching] = useState(false);
  const closeSearch = useCallback(() => setSearching(false), []);
  const list = useRef<FlashListRef<NoteMeta>>(null), groupedList = useRef<FlashListRef<GroupRow>>(null);
  const defs = useTags((s) => s.defs);

  // Before a change that moves tiles: the next commit animates them to where they land, recycling off for it
  const reflow = useCallback(() => {
    list.current?.prepareForLayoutAnimationRender();
    groupedList.current?.prepareForLayoutAnimationRender();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, []);
  const refresh = () => { setPulling(true); Promise.all([syncTodo(), syncNotes()]).finally(() => setPulling(false)); };

  const names = useMemo(() => allTagNames(defs, notes.map((n) => n.tags)), [defs, notes]);
  const tagFilter = useMemo(() => {
    const counted = names.map((name) => ({ name, count: notes.filter((n) => inGroup(n.tags, [name])).length })).filter((t) => t.count);
    // a chosen tag no note carries now stays to be unchosen
    const missing = filters.filter((f) => f !== NO_TAG && !counted.some((t) => fold(t.name) === fold(f))).map((name) => ({ name, count: 0 }));
    return { tags: [...missing, ...counted], untagged: notes.filter((n) => !n.tags.length).length };
  }, [names, notes, filters]);
  const shown = useMemo(() => sortNotes(notes.filter((n) => inGroup(n.tags, filters)), sort, (n) => n), [notes, filters, sort]);
  const groups = useMemo(() => (grouped ? groupNotes(shown, names, filters) : []), [grouped, shown, names, filters]);
  const folded = useCallback((t: string) => collapsed.some((c) => fold(c) === fold(t)), [collapsed]);
  const toggleGroup = useCallback((t: string) => { reflow(); usePrefs.getState().set({ collapsedTags: flipped(collapsed, t) }); }, [collapsed, reflow]);

  // Selection: only what is on screen counts, so a filter can't leave notes selected out of sight
  const onScreen = useMemo(() => new Set(shown.map((n) => n.path)), [shown]);
  const picked = useMemo(() => sel.filter((p) => onScreen.has(p)), [sel, onScreen]);
  const selecting = picked.length > 0;
  useEffect(() => {
    if (!selecting) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { setSel([]); return true; });
    return () => sub.remove();
  }, [selecting]);
  const press = useCallback((path: string) => {
    if (!selecting) return openNote(path);
    Haptics.selectionAsync();
    setSel((s) => toggled(s, path));
  }, [selecting]);
  const hold = useCallback((path: string) => setSel((s) => (s.includes(path) ? s : [...s, path])), []);

  // A day in the slot: today's list, or Upcoming at that day; the page scrolls back up to the box if it is out of sight
  const pick = (day: string) => {
    setTab(day === today ? "today" : "upcoming");
    setFocus(day === today ? null : { day, n: (focus?.n ?? 0) + 1 });
    setViewing(null);
    const top = Math.max(0, boxTop.current - insets.top - 8);
    if (scrolled.current > top) (grouped ? groupedList : list).current?.scrollToOffset({ offset: top, animated: true });
  };
  const pickTab = (t: BoxTab) => { setTab(t); setFocus(null); setViewing(null); };

  const tile = (item: NoteMeta) => (
    <NoteTile n={item} now={now} local={local} selecting={selecting} selected={picked.includes(item.path)} onPress={press} onLong={hold} />
  );

  // The mark is the lens (the one place it is picked, a filter on the whole app); the corner opens and closes Search
  const top = (
    <View className="flex-row items-center gap-1 pl-4 pr-2" style={{ height: 44 }}>
      <View className="flex-1"><LensSwitcher /></View>
      <IconButton label={searching ? "Close search" : "Search"} icon={searching ? X : Search} size={22} color={searching ? C.brand : C.dim}
        onPress={() => setSearching((s) => !s)} />
    </View>
  );
  const header = (
    <View className="gap-2 pb-4" style={{ paddingTop: insets.top + 8 }}>
      {top}
      <View className="gap-2" onLayout={(e) => { boxTop.current = e.nativeEvent.layout.y; }}>
        <Days today={today} day={tab === "today" ? today : tab === "upcoming" ? viewing ?? focus?.day ?? null : null} onPick={pick}
          onAdd={(day) => setAdding(day === today ? "today" : { day })} />
        <TaskBox today={today} tab={tab} onTab={pickTab} focus={focus} onView={setViewing} actions={actions}
          onAdd={() => setAdding(tab === "today" ? "today" : tab === "inbox" ? "clear" : "tomorrow")} />
      </View>
      <NotesBar count={shown.length} tags={tagFilter.tags} untagged={tagFilter.untagged} filter={filters} sort={sort}
        onSort={(s) => { reflow(); usePrefs.getState().set({ notesSort: s }); setLimit(PAGE); setSel([]); }}
        onFilter={(tags) => { reflow(); usePrefs.getState().set({ notesTags: tags }); setLimit(PAGE); setSel([]); }} grouped={grouped}
        onGrouped={(on) => { reflow(); usePrefs.getState().set({ notesView: on ? "tags" : "list" }); }} onAdd={newNote} />
    </View>
  );

  const empty = filters.length
    ? <EmptyState icon={SearchX} title="Nothing matches" hint={filters.map((f) => (f === NO_TAG ? "No tag" : `#${f}`)).join(" ")} />
    : lens
      ? <EmptyState icon={NotebookPen} title={`Nothing in ${lens.name}`} hint="Notes this lens lets through show here. Tap the + beside Notes to write one." />
      : <EmptyState icon={NotebookPen} title="No notes yet" hint="Tap the + beside Notes to write your first one." />;
  const listProps = {
    contentContainerStyle: { paddingHorizontal: 12, paddingBottom: 24 },
    keyboardShouldPersistTaps: "handled",
    refreshControl: <RefreshControl refreshing={pulling} onRefresh={refresh} colors={[C.brand]} tintColor={C.brand} progressBackgroundColor={C.raised} />,
    ListHeaderComponent: header, ListEmptyComponent: empty,
    onScroll: (e: { nativeEvent: { contentOffset: { y: number } } }) => { scrolled.current = e.nativeEvent.contentOffset.y; }, scrollEventThrottle: 100,
  } as const;

  return (
    <View className="flex-1 bg-bg">
      {searching
        ? <View className="flex-1" style={{ paddingTop: insets.top + 8 }}><SearchDrawer header={top} onClose={closeSearch} /></View>
        : grouped
        ? <GroupedNotes listRef={groupedList} groups={groups} folded={folded} onToggle={toggleGroup} renderNote={tile} extraData={picked} {...listProps} />
        /* Two staggered columns, a page of tiles at a time; the cell's 4dp on every side makes 8dp between tiles and, with the list's 12dp, a 16dp gutter */
        : <FlashList ref={list} data={shown.slice(0, limit)} keyExtractor={key} numColumns={2} masonry extraData={picked} renderItem={({ item }) => tile(item)}
          onEndReached={() => setLimit((n) => (n < shown.length ? n + PAGE : n))} onEndReachedThreshold={1.5} {...listProps} />}
      {selecting ? (
        <View className="absolute inset-x-0 top-0 z-20 bg-bg" style={{ elevation: 20 }}>
          <SelectionBar paths={picked} onExit={() => setSel([])} onReflow={reflow} />
        </View>
      ) : null}
      {dialogs}
      <AddSheet open={adding !== null} start={adding ?? "clear"} onClose={() => setAdding(null)} />
    </View>
  );
}
