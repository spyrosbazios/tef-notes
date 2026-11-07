// The tag filter: a chip opening a sheet of every tag with a checkbox (several at once narrow the list to what carries any
// of them, "No tag" the untagged). Home's notes bar and task box use it; the notes' choice is the `notesTags` pref, kept
// across launches.
import { ListFilter } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { NO_TAG } from "@/core/note-groups";
import { fold } from "@/core/notes";
import { Checkbox, Chip, Sheet, T, Touchable } from "./ds";

export type StripTag = { name: string; count: number };

/** What the filter button reads: nothing chosen, the untagged, one name, or how many. A long name is cut to keep the row one line. */
function summary(value: string[]): string {
  if (!value.length) return "All";
  if (value.includes(NO_TAG)) return "No tag";
  if (value.length > 1) return `${value.length} tags`;
  return value[0].length > 16 ? `${value[0].slice(0, 15)}…` : value[0];
}

/** One choice in the filter sheet: a checkbox, the name, and how many of `what` carry it. */
function FilterRow({ name, count, what, on, onPress }: { name: string; count?: number; what: string; on: boolean; onPress: () => void }) {
  return (
    <Touchable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={count == null ? name : `${name}, ${count} ${what}`}
      className="min-h-12 flex-row items-center gap-3 rounded-xl px-3">
      <View pointerEvents="none"><Checkbox checked={on} onCheckedChange={() => {}} /></View>
      <T size={15} numberOfLines={1} className="flex-1">{name}</T>
      {count != null ? <T tone="faint" font="num" size={13}>{count}</T> : null}
    </Touchable>
  );
}

/** The filter as a chip naming what is chosen, opening the sheet of every tag. "No tag" stands alone: choosing it drops the
 *  tags, choosing a tag drops it. Shared by Home's notes bar and its task box. `what` the list holds
 *  (its counts' word); `bare`: only the icon while nothing is chosen, for a crowded row. */
export function TagFilter({ tags, untagged, value, onChange, what, bare, className }: {
  tags: StripTag[]; untagged: number; value: string[]; onChange: (tags: string[]) => void; what: "notes" | "tasks"; bare?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const on = (name: string) => value.some((v) => (name === NO_TAG ? v === NO_TAG : fold(v) === fold(name)));
  const pick = (name: string) => {
    if (name === NO_TAG) { onChange(on(NO_TAG) ? [] : [NO_TAG]); return; }
    const rest = value.filter((v) => v !== NO_TAG);
    onChange(on(name) ? rest.filter((v) => fold(v) !== fold(name)) : [...rest, name]);
  };
  return (
    <>
      <Chip size="sm" icon={ListFilter} label={bare && !value.length ? undefined : summary(value)} selected={value.length > 0} onPress={() => setOpen(true)}
        className={className} accessibilityLabel={`Filter ${what} by tag: ${summary(value)}`} />
      <Sheet open={open} onOpenChange={setOpen} title="Filter by tag" scroll>
        <View className="gap-1 px-2">
          <FilterRow name={`All ${what}`} what={what} on={!value.length} onPress={() => onChange([])} />
          {untagged || on(NO_TAG) ? <FilterRow name="No tag" count={untagged} what={what} on={on(NO_TAG)} onPress={() => pick(NO_TAG)} /> : null}
          {tags.map((t) => <FilterRow key={t.name} name={t.name} count={t.count} what={what} on={on(t.name)} onPress={() => pick(t.name)} />)}
        </View>
      </Sheet>
    </>
  );
}
