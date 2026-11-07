// Search, Home's drawer (the header's search button opens it under the header, back or the cross closes it): the one place the
// phone searches, on Home itself. One field; under it the notes it finds as list tiles
// (SQLite FTS5, best match first; a word may match a tag), the tasks, tags and the screens to jump to. A finished `#tag` becomes
// a chip in the field and narrows notes and tasks alike; a tag still being typed is a prefix, and the Tags rows offer the names
// (tap: a chip). Everything respects the lens that is on, as the lists do. Tapping a result opens it, a long press on a note its
// actions (as a right-click does in the web's palette); the palette also previews the highlighted note, which has no room on a phone.
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import { Archive, CalendarDays, Check, Hash, Inbox, ListTodo, MessageSquare, Settings, Sparkles, Star, type LucideIcon } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { BackHandler, View } from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";
import { fold, snippetOf } from "@/core/notes";
import { absorbTags, allTagNames, dropTyping, matchesTags, matchesTask, parseTagQuery, suggestTags, typingTag } from "@/core/tags";
import { search } from "@/store/db";
import { useActiveLens } from "@/store/lenses";
import { useNoteList, useNotes, type NoteMeta } from "@/store/notes";
import { useTags } from "@/store/tags";
import { useTasks } from "@/store/todo";
import { useNow } from "@/ui/fmt";
import { EmptyState, ListRow, ListSection, SearchField, T } from "@/ui/ds";
import { NoteMenu } from "@/ui/actions";
import { openNote } from "@/ui/note";
import { NoteTile } from "@/ui/note-tile";
import { openTask, openTaskList, type TaskListKey } from "@/ui/tasks";

const LIMIT = 50;

/** The screens a search can jump to: the other tabs, the Tasks lists, Chats and Settings. */
const VIEWS: { label: string; icon: LucideIcon; go: () => void }[] = [
  ...([["inbox", "Inbox", Inbox], ["today", "Today", Star], ["upcoming", "Upcoming", CalendarDays], ["logbook", "Logbook", Archive]] as [TaskListKey, string, LucideIcon][])
    .map(([key, label, icon]) => ({ label, icon, go: () => openTaskList(key) })),
  { label: "Ask the assistant", icon: Sparkles, go: () => router.navigate("/ask") },
  { label: "Past chats", icon: MessageSquare, go: () => router.push("/chats") },
  { label: "Settings", icon: Settings, go: () => router.navigate("/settings") },
];

type Row = { key: string; kind: "head"; title: string } | { key: string; kind: "note"; n: NoteMeta; hit?: string } | { key: string; kind: "block"; node: ReactNode };

/** Home while searching: `header` is Home's own top row, kept above the field; `onClose` puts the notes back. */
export function SearchDrawer({ header, onClose }: { header: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { onClose(); return true; });
    return () => sub.remove();
  }, [onClose]);
  const lens = useActiveLens();
  const all = useNoteList();                                       // inside the lens that is on
  const tasks = useTasks();
  const defs = useTags((s) => s.defs);
  const local = useNotes((s) => s.sync.state === "off");
  const now = useNow();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");                          // q once typing pauses
  const [chips, setChips] = useState<string[]>([]);              // finished `#tag`s, matched as typed ones are
  const [menu, setMenu] = useState<string | null>(null);          // the note whose actions are open

  // The chips and the words typed, as one query: `#tag`s narrow notes and tasks, the rest is searched for
  const typedQuery = q.trim() ? query.trim() : "";
  const wanted = [...chips.map((c) => `#${c}`), typedQuery].filter(Boolean).join(" ");
  const { tags: typed, text } = useMemo(() => parseTagQuery(wanted), [wanted]);
  const names = useMemo(() => allTagNames(defs, all.map((n) => n.tags)), [defs, all]);

  // Hits in rank order, drawn from the list so the lens, flags and ages match it. `#tag`s typed narrow them (a prefix); with no
  // words, the newest notes that carry the tags.
  const [notes, snips] = useMemo((): [NoteMeta[], Map<string, string>] => {
    if (!text) return [typed.length ? all.filter((n) => matchesTags(n.tags, typed)).slice(0, LIMIT) : [], new Map()];
    const hits = search(text, lens ? 200 : LIMIT), by = new Map(all.map((n) => [n.path, n]));
    const kept = hits.flatMap((h) => { const n = by.get(h.path); return n && matchesTags(n.tags, typed) ? [n] : []; }).slice(0, LIMIT);
    return [kept, new Map(hits.map((h) => [h.path, h.snippet]))];
  }, [text, typed, all, lens]);
  const taskHits = useMemo(() => (wanted ? tasks.filter(matchesTask(wanted)).slice(0, LIMIT) : []), [tasks, wanted]);
  const tagHits = useMemo(() => {
    if (!typedQuery) return [];
    return suggestTags(names, typingTag(typedQuery) ?? parseTagQuery(typedQuery).tags.at(-1) ?? typedQuery, chips);
  }, [names, typedQuery, chips]);
  const views = useMemo(() => (wanted ? VIEWS.filter((v) => fold(v.label).includes(fold(wanted))) : VIEWS), [wanted]);

  // Words typed: a finished `#tag` leaves the text for a chip
  const change = (v: string) => {
    const a = absorbTags(v);
    if (a.done.length) setChips((c) => [...c, ...a.done.filter((d) => !c.some((x) => fold(x) === fold(d)))]);
    setQ(a.text);
  };
  const pick = useCallback((name: string) => {
    setChips((c) => (c.some((x) => fold(x) === fold(name)) ? c : [...c, name]));
    const rest = dropTyping(q);
    setQ(rest); setQuery(rest);
  }, [q]);

  const rows = useMemo((): Row[] => {
    const out: Row[] = [];
    if (notes.length) {
      out.push({ key: "h:notes", kind: "head", title: "Notes" });
      for (const n of notes) out.push({ key: n.path, kind: "note", n, hit: snips.get(n.path) });
    }
    if (taskHits.length) {
      out.push({ key: "h:tasks", kind: "head", title: "Tasks" });
      out.push({
        key: "tasks", kind: "block", node: (
          <ListSection>
            {taskHits.map((t) => (
              <ListRow key={t.id} title={t.title || "Untitled"} subtitle={[t.done ? "Completed" : "", snippetOf(t.notes, 80)].filter(Boolean).join(" · ") || undefined}
                icon={t.done ? Check : ListTodo} onPress={() => openTask(t.id)} />
            ))}
          </ListSection>
        ),
      });
    }
    if (tagHits.length) {
      out.push({ key: "h:tags", kind: "head", title: "Tags" });
      out.push({ key: "tags", kind: "block", node: <ListSection>{tagHits.map((t) => <ListRow key={t} title={t} icon={Hash} onPress={() => pick(t)} />)}</ListSection> });
    }
    if (views.length) {
      out.push({ key: "h:go", kind: "head", title: "Go" });
      out.push({ key: "go", kind: "block", node: <ListSection>{views.map((v) => <ListRow key={v.label} title={v.label} icon={v.icon} chevron onPress={v.go} />)}</ListSection> });
    }
    return out;
  }, [notes, snips, taskHits, tagHits, views, pick]);

  const found = notes.length + taskHits.length + tagHits.length + views.length > 0;
  return (
    <View className="flex-1 bg-bg">
      <FlashList data={rows} keyExtractor={(r) => r.key} getItemType={(r) => r.kind} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24 }}
        ListHeaderComponent={(
          <View className="-mx-3">
            {header}
            <Animated.View entering={FadeInUp.duration(180)} className="pb-2">
              <SearchField value={q} onChangeText={change} debounce={200} onDebouncedChange={(v) => setQuery(absorbTags(v).text)} placeholder="Search notes, tasks, or #tag"
                autoFocus containerClassName="px-4" tokens={chips} onRemoveToken={(t) => setChips((c) => c.filter((x) => fold(x) !== fold(t)))} />
              {lens ? <T tone="faint" size={12} className="px-5 pt-2">Searching inside {lens.name}</T> : null}
            </Animated.View>
          </View>
        )}
        ListEmptyComponent={found ? null : <EmptyState icon={ListTodo} title="Nothing matches" hint={wanted || undefined} />}
        renderItem={({ item }) => item.kind === "head" ? <T variant="label" size={12} className="px-3 pb-1 pt-3">{item.title}</T>
          : item.kind === "block" ? <View className="px-1">{item.node}</View>
            : <NoteTile n={item.n} hit={item.hit} now={now} local={local} selecting={false} selected={false} onPress={openNote} onLong={setMenu} />} />
      <NoteMenu path={menu} onClose={() => setMenu(null)} />
    </View>
  );
}
