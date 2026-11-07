// Tags on screen: a badge in the tag's colour (tapping one filters Home's notes to it) and a row of them for a list tile. The note
// screen's own row and picker are note-tags.tsx and tag-dialog.tsx; Settings' list of definitions is tag-list.tsx. Colours
// are the note colours, so a tag looks like the card tint it was given.
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { X } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { tagColor } from "@/core/tags";
import { usePrefs } from "@/store/prefs";
import { useTags } from "@/store/tags";
import { T } from "./ds";
import { alpha } from "@/core/theme";
import { useTheme } from "./use-theme";

/** Shows Home's notes filtered to that tag, from wherever the badge was tapped. */
export function filterBy(name: string) {
  Haptics.selectionAsync();
  usePrefs.getState().set({ notesTags: [name] });
  router.navigate("/home");
}

/** One tag. `onPress` defaults to the filter; `onLongPress` for taking it off a note. */
export function TagBadge({ name, onPress = () => filterBy(name), onLongPress, clear }: { name: string; onPress?: () => void; onLongPress?: () => void; clear?: boolean }) {
  const { NOTE_COLORS } = useTheme();
  const P = NOTE_COLORS[useTags((s) => tagColor(s.defs, name))];
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} hitSlop={6} accessibilityRole="button"
      accessibilityLabel={clear ? `Stop filtering by ${name}` : `Tag ${name}`}
      accessibilityHint={clear ? undefined : onLongPress ? "Tap to show notes with this tag, long press to take it off" : "Shows notes with this tag"}
      className="h-[18px] shrink flex-row items-center gap-1 rounded-full px-2 self-start" style={{ backgroundColor: alpha(P.line, 0.22) }}>
      <T font="medium" size={10.5} numberOfLines={1} className="shrink" style={{ color: P.fg }}>{name}</T>
      {clear ? <X size={10} color={P.fg} /> : null}
    </Pressable>
  );
}

/** A note's tags as badges; at most `max` of them (3: what a list tile has room for), the rest a count. On one line, a
 *  long name cut short, so a tile's height never depends on its tags; `children` follow the badges. `onPress`: what a badge does
 *  instead of filtering Home's notes (a task row opens the task). */
export function TagRow({ tags, max = 3, onPress, children }: { tags: string[]; max?: number; onPress?: () => void; children?: ReactNode }) {
  if (!tags.length && !children) return null;
  return (
    <View className="flex-row items-center gap-1.5 overflow-hidden">
      {tags.slice(0, max).map((t) => (
        <TagBadge key={t} name={t} onPress={onPress} />
      ))}
      {tags.length > max ? <T tone="faint" font="medium" size={10.5} className="shrink-0">+{tags.length - max}</T> : null}
      {children}
    </View>
  );
}
