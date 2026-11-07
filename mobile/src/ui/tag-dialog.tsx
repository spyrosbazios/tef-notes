// Putting tags on records by hand: one note or task (its tags chip, the note menu) or many notes (the list's
// selection). It works on a `TagTarget` (tag-targets.ts), so a note and a task are the same sheet. Names to pick are the
// definitions and what notes and tasks already carry; a tag on only some of the records shows dashed, and tapping a
// name puts it on all of them, or takes it off when they all have it.
import * as Haptics from "expo-haptics";
import { Check, Plus } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { tagChange, tagState } from "@/core/bulk";
import { fold } from "@/core/notes";
import { suggestTags, tagColor } from "@/core/tags";
import { TAG_MAX } from "@/core/todo";
import { useTags } from "@/store/tags";
import { Button, Input, Sheet, T } from "./ds";
import { useTagNames, type TagTarget } from "./tag-targets";
import { useTheme } from "./use-theme";

function NameChip({ name, state, onPress }: { name: string; state: "all" | "some" | "none"; onPress: () => void }) {
  const { NOTE_COLORS } = useTheme();
  const P = NOTE_COLORS[useTags((s) => tagColor(s.defs, name))];
  return (
    <Pressable onPress={onPress} hitSlop={4} accessibilityRole="checkbox" accessibilityState={{ checked: state === "all" ? true : state === "some" ? "mixed" : false }}
      accessibilityLabel={name}
      className={`h-9 flex-row items-center gap-1.5 rounded-full border px-3.5 active:opacity-70 ${state === "some" ? "border-dashed" : ""}`}
      style={{ backgroundColor: state === "all" ? P.bg : undefined, borderColor: P.line }}>
      {state === "all" ? <Check size={14} color={P.fg} strokeWidth={2.6} /> : null}
      <T font="semi" size={14} numberOfLines={1} style={{ color: P.fg }}>{name}</T>
    </Pressable>
  );
}

/** `target` is what it works on; open while `open`. A sheet: the keyboard lifts it, and the chips stay in reach. */
export function TagDialog({ target, open, onClose }: { target: TagTarget; open: boolean; onClose: () => void }) {
  const { C } = useTheme();
  const [v, setV] = useState("");
  const { lists, change } = target;
  const names = useTagNames();
  const typed = v.trim().replace(/^#/, "");
  const shown = suggestTags(names, typed, [], 40);
  const exact = names.find((n) => fold(n) === fold(typed));
  const toggle = (name: string) => { Haptics.selectionAsync(); const c = tagChange(lists, name); change(c.add, c.remove); };
  const add = () => { if (typed) { Haptics.selectionAsync(); change([exact ?? typed], []); setV(""); } };
  const close = () => { setV(""); onClose(); };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) close(); }} title={target.title} scroll>
      <View className="gap-3">
        <Input value={v} onChangeText={(t) => setV(t.replace(/[,\r\n]/g, ""))} onSubmitEditing={add} placeholder="Find or add a tag" autoCapitalize="none" autoCorrect={false}
          maxLength={TAG_MAX} returnKeyType="done" submitBehavior="submit" accessibilityLabel="Tag name" />
        <View className="flex-row flex-wrap gap-2">
          {typed && !exact ? (
            <Pressable onPress={add} hitSlop={4} accessibilityRole="button" accessibilityLabel={`Add the tag ${typed}`}
              className="h-9 flex-row items-center gap-1.5 rounded-full border border-dashed border-line px-3.5 active:opacity-70">
              <Plus size={14} color={C.fg} />
              <T font="semi" size={14} numberOfLines={1}>{typed}</T>
            </Pressable>
          ) : null}
          {shown.map((n) => <NameChip key={n} name={n} state={tagState(lists, n)} onPress={() => toggle(n)} />)}
          {!shown.length && !typed ? <T tone="faint" size={13}>No tags yet. Type a name to make one.</T> : null}
        </View>
        <Button onPress={close} className="mt-1">Done</Button>
      </View>
    </Sheet>
  );
}
