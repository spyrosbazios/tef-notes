// A record's tags as one dropdown chip: its names, shortened to fit. It opens the multi-select picker (tag-dialog.tsx).
// The note's meta strip and the task's card both draw it.
import { ChevronDown, Tag } from "lucide-react-native";
import { Pressable } from "react-native";
import { T } from "./ds";
import { useTheme } from "./use-theme";

/** `className` places it (the note's strip puts it right, the task's left). */
export function TagsChip({ tags, onPress, className = "" }: { tags: string[]; onPress: () => void; className?: string }) {
  const { C } = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={4} accessibilityRole="button"
      accessibilityLabel={`Tags: ${tags.length ? tags.join(", ") : "none"}`}
      accessibilityHint="Opens the tag picker"
      className={`h-9 max-w-[70%] shrink flex-row items-center gap-1.5 rounded-full border border-line px-3 active:opacity-70 ${className}`}>
      <Tag size={13} color={C.dim} />
      <T font="semi" size={13} numberOfLines={1} className="shrink">{tags.length ? tags.join(", ") : "Tag"}</T>
      <ChevronDown size={14} color={C.dim} />
    </Pressable>
  );
}
