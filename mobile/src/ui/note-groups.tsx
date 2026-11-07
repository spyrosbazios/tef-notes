// Home's grouped notes view: a header per tag (a note with several tags is under each; "No tag" last), each folding its
// notes away, and under a header the notes two to a row, drawn by the caller (the same NoteTile as the flat view). One
// single-column FlashList of headers and note rows: a masonry grid can't hold full-width headers.
import { FlashList, type FlashListProps, type FlashListRef } from "@shopify/flash-list";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { memo, useMemo, type ReactElement, type Ref } from "react";
import { View } from "react-native";
import { NO_TAG, type Group } from "@/core/note-groups";
import { tagColor } from "@/core/tags";
import type { NoteMeta } from "@/store/notes";
import { useTags } from "@/store/tags";
import { PressScale, T } from "./ds";
import { useTheme } from "./use-theme";

export type GroupRow =
  | { kind: "head"; key: string; tag: string; count: number; folded: boolean }
  | { kind: "notes"; key: string; a: NoteMeta; b?: NoteMeta };

/** The groups as list rows: a header, then (unless folded) its notes two to a row. */
export function rowsOf(groups: Group<NoteMeta>[], folded: (tag: string) => boolean): GroupRow[] {
  const out: GroupRow[] = [];
  for (const g of groups) {
    const f = folded(g.tag);
    out.push({ kind: "head", key: `h:${g.tag}`, tag: g.tag, count: g.notes.length, folded: f });
    if (f) continue;
    for (let i = 0; i < g.notes.length; i += 2) out.push({ kind: "notes", key: `n:${g.tag}:${g.notes[i].path}`, a: g.notes[i], b: g.notes[i + 1] });
  }
  return out;
}

const Header = memo(function Header({ tag, count, folded, onPress }: { tag: string; count: number; folded: boolean; onPress: (tag: string) => void }) {
  const { C, NOTE_COLORS } = useTheme();
  const P = NOTE_COLORS[useTags((s) => (tag === NO_TAG ? "gray" : tagColor(s.defs, tag)))];
  const name = tag === NO_TAG ? "No tag" : tag, Chevron = folded ? ChevronRight : ChevronDown;
  return (
    <PressScale onPress={() => onPress(tag)} accessibilityRole="button" accessibilityState={{ expanded: !folded }}
      accessibilityLabel={`${name}, ${count} note${count === 1 ? "" : "s"}`} accessibilityHint={folded ? "Shows these notes" : "Hides these notes"}
      className="mx-1 mt-3 min-h-12 flex-row items-center gap-2.5 px-2">
      <View className="h-3 w-3 rounded-full border" style={{ backgroundColor: P.line, borderColor: P.fg }} />
      <T font="heavy" size={16} numberOfLines={1} className="flex-1">{name}</T>
      <T tone="faint" font="num" size={13}>{count}</T>
      <Chevron size={18} color={C.dim} />
    </PressScale>
  );
});

export function GroupedNotes({ groups, folded, onToggle, renderNote, listRef, ...list }: {
  groups: Group<NoteMeta>[]; folded: (tag: string) => boolean; onToggle: (tag: string) => void;
  renderNote: (n: NoteMeta) => ReactElement; listRef: Ref<FlashListRef<GroupRow>>;
} & Pick<FlashListProps<GroupRow>, "extraData" | "onScroll" | "scrollEventThrottle" | "contentContainerStyle" | "keyboardShouldPersistTaps" | "keyboardDismissMode" | "refreshControl" | "ListEmptyComponent" | "ListHeaderComponent">) {
  const rows = useMemo(() => rowsOf(groups, folded), [groups, folded]);
  return (
    <FlashList ref={listRef} data={rows} keyExtractor={(r) => r.key} getItemType={(r) => r.kind} {...list}
      renderItem={({ item }) => item.kind === "head"
        ? <Header tag={item.tag} count={item.count} folded={item.folded} onPress={onToggle} />
        : (
          <View className="flex-row">
            <View className="flex-1">{renderNote(item.a)}</View>
            <View className="flex-1">{item.b ? renderNote(item.b) : null}</View>
          </View>
        )} />
  );
}
