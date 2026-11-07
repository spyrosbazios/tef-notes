// The note screen's meta strip, one line that never scrolls sideways: the date and sync state, then the note's tags
// as one chip (tags-chip.tsx) opening the picker (tag-dialog.tsx). `missing`: the note's text isn't on this phone, so
// there is nothing to tag yet.
import { useState } from "react";
import { View } from "react-native";
import { T } from "./ds";
import { TagDialog } from "./tag-dialog";
import { useNoteTags } from "./tag-targets";
import { TagsChip } from "./tags-chip";

export function NoteMeta({ path, tags, missing, info, warn }: { path: string; tags: string[]; missing?: boolean; info: string; warn?: boolean }) {
  const target = useNoteTags([path]);
  const [picking, setPicking] = useState(false);
  if (missing && !tags.length && !info) return null;
  return (
    <>
      <View className="flex-row items-center gap-2 px-5 py-1">
        {info ? <T tone={warn ? "warn" : "faint"} size={12} numberOfLines={1} className="shrink">{info}</T> : null}
        {missing ? null : <TagsChip tags={tags} onPress={() => setPicking(true)} className="ml-auto" />}
      </View>
      <TagDialog target={target} open={picking} onClose={() => setPicking(false)} />
    </>
  );
}
