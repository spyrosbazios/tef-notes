// One task, as Things' card: its title with the box, its notes (markdown text; with a picture in them, read as markdown: ui/task-notes.tsx), its checklist (add, tick, edit, remove) on
// a raised card that eases up into place, then When, deadline, repeat and reminder, each a row opening its
// sheet (ui/task-sheets.tsx), then the notes it is about (links, core/record-links.ts; the picker sheet links another), then a red Delete button (it asks first). Its tags are a chip under the checklist, opening the same picker
// notes use (ui/tag-dialog.tsx). Edits are the store's (`useTodo`), saved as they are made; the box
// waits 1.5 s like a row's (store/ticks.ts).
import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import { Bell, CalendarDays, Flag, NotebookText, Plus, Repeat, Trash2, X, type LucideIcon } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useShallow } from "zustand/react/shallow";
import { everyLabel, whenLabel } from "@/core/dates";
import { linksFrom } from "@/core/record-links";
import { dueLabel } from "@/core/things";
import { addItem, removeItem, setItem } from "@/core/todo";
import { localDay } from "@/core/time";
import { useNotes, useRecPath } from "@/store/notes";
import { toggleTask, useTicking } from "@/store/ticks";
import { useTodo } from "@/store/todo";
import { useDraft } from "@/ui/draft";
import { Button, ListRow, ListSection, ScreenHeader, T } from "@/ui/ds";
import { goBack, openNote } from "@/ui/note";
import { Box } from "@/ui/tasks";
import { TagDialog } from "@/ui/tag-dialog";
import { useTaskTags } from "@/ui/tag-targets";
import { TagsChip } from "@/ui/tags-chip";
import { TaskNotes } from "@/ui/task-notes";
import { useTaskActions, type Kind } from "@/ui/task-sheets";
import { useTheme } from "@/ui/use-theme";

/** One property of the task: its value (or the word for it, dim, when unset) and what it is, opening its sheet. */
function Prop({ icon, label, value, tone, onPress, trailing }: {
  icon: LucideIcon; label: string; value: string | null; tone?: "warn"; onPress: () => void; trailing?: React.ReactNode;
}) {
  const { C } = useTheme();
  return (
    <ListRow icon={icon} iconColor={tone === "warn" && value ? C.warn : value ? C.brand : C.dim} title={value ?? label} subtitle={value ? label : undefined}
      onPress={onPress} chevron={!trailing} trailing={trailing} />
  );
}

/** One checklist item: its box, its text (edited in place), and a cross. */
function Item({ taskId, id }: { taskId: string; id: string }) {
  const { C } = useTheme();
  const item = useTodo((s) => s.tasks[taskId]?.checklist.find((i) => i.id === id));
  const draft = useDraft(item?.text ?? "", (text) => {
    const t = useTodo.getState().tasks[taskId];
    if (t && text.trim()) useTodo.getState().update(taskId, { checklist: setItem(t, id, { text }).checklist });
  });
  if (!item) return null;
  const change = (checklist: ReturnType<typeof removeItem>["checklist"]) => useTodo.getState().update(taskId, { checklist });
  return (
    <View className="flex-row items-center gap-3.5 px-5">
      <Box done={item.done} size={20} label={item.text} onPress={() => {
        const t = useTodo.getState().tasks[taskId];
        if (t) change(setItem(t, id, { done: !item.done }).checklist);
      }} />
      <TextInput {...draft} placeholderTextColor={C.faint} accessibilityLabel="Checklist item" returnKeyType="done" submitBehavior="blurAndSubmit"
        className="flex-1 py-3 font-sans text-fg" style={{ fontSize: 15, textDecorationLine: item.done ? "line-through" : "none", opacity: item.done ? 0.5 : 1 }} />
      <Pressable hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${item.text}`} onPress={() => {
        const t = useTodo.getState().tasks[taskId];
        if (t) change(removeItem(t, id).checklist);
      }}>
        <X size={16} color={C.dim} />
      </Pressable>
    </View>
  );
}

function AddItem({ taskId }: { taskId: string }) {
  const { C } = useTheme();
  const [text, setText] = useState("");
  const add = () => {
    const t = useTodo.getState().tasks[taskId];
    if (!text.trim() || !t) return;
    Haptics.selectionAsync();
    useTodo.getState().update(taskId, { checklist: addItem(t, text).checklist });
    setText("");
  };
  return (
    <View className="flex-row items-center gap-3.5 px-5">
      <Plus size={20} color={C.dim} />
      <TextInput value={text} onChangeText={setText} onSubmitEditing={add} placeholder="Add an item" placeholderTextColor={C.faint} accessibilityLabel="Add a checklist item"
        returnKeyType="done" submitBehavior="submit" className="flex-1 py-3 font-sans text-fg" style={{ fontSize: 15 }} />
    </View>
  );
}

/** The task's tags: one chip, and the picker it opens. */
function TaskTags({ taskId }: { taskId: string }) {
  const target = useTaskTags([taskId]);
  const [picking, setPicking] = useState(false);
  return (
    <>
      <View className="flex-row px-5 pb-1 pt-2">
        <TagsChip tags={target.lists[0] ?? []} onPress={() => setPicking(true)} />
      </View>
      <TagDialog target={target} open={picking} onClose={() => setPicking(false)} />
    </>
  );
}

/** One note the task is about: `link` the link's id, `rec` the note's record id; the cross unlinks it. */
function LinkedNote({ link, rec }: { link: string; rec: string }) {
  const { C } = useTheme();
  const path = useRecPath(rec);
  const meta = useNotes((s) => (path ? s.notes[path] : undefined));
  const title = meta?.title ?? "A note not on this phone";
  const show = path ? () => openNote(path) : undefined;
  return (
    <ListRow title={title} onPress={show} icon={NotebookText} iconColor={meta ? C.brand : C.dim}
      trailing={(
        <Pressable hitSlop={10} accessibilityRole="button" accessibilityLabel={`Unlink ${title}`} className="justify-center pl-2"
          onPress={() => { Haptics.selectionAsync(); useTodo.getState().removeLink(link); }}>
          <X size={16} color={C.dim} />
        </Pressable>
      )} />
  );
}

/** The notes the task is about, and a row to link another (`onAdd`: the picker sheet). */
function LinkedNotes({ taskId, onAdd }: { taskId: string; onAdd: () => void }) {
  const links = useTodo(useShallow((s) => linksFrom(s.links, { type: "task", id: taskId }, "about").filter((l) => l.to.type === "note")));
  return (
    <ListSection title="Linked notes">
      {links.map((l) => <LinkedNote key={l.id} link={l.id} rec={l.to.id} />)}
      <ListRow key="add" icon={Plus} title="Link a note" onPress={onAdd} />
    </ListSection>
  );
}

export default function TaskRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { C } = useTheme();
  const insets = useSafeAreaInsets();
  const task = useTodo((s) => s.tasks[id]);
  const ticking = useTicking((s) => !!s.ids[id]);
  const { actions, dialogs, openSheet } = useTaskActions(() => goBack("/today"));
  const today = localDay();
  const title = useDraft(task?.title ?? "", (v) => { if (v.trim() && task) useTodo.getState().update(id, { title: v }); });
  const notes = useDraft(task?.notes ?? "", (v) => { if (task) useTodo.getState().update(id, { notes: v }); });

  const bar = (
    <ScreenHeader compact title="" back={() => goBack("/today")} />
  );
  if (!task) {
    return (
      <View className="flex-1 bg-bg">
        {bar}
        <T tone="dim" size={14} className="px-5 pt-4">{"This task isn't on this phone."}</T>
      </View>
    );
  }

  const done = !!task.done || ticking, due = task.due ? dueLabel(task.due, today) : null;
  const open = (kind: Kind) => { Haptics.selectionAsync(); openSheet({ id, kind }); };

  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1 bg-bg">
      {bar}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <View className="mx-4 mt-1 overflow-hidden rounded-3xl bg-card pb-2 pt-4">
          <View className="flex-row items-start gap-3.5 px-5 pb-1">
            <View className="mt-1.5"><Box done={done} size={26} label={task.title} onPress={() => toggleTask(id)} /></View>
            <TextInput {...title} multiline submitBehavior="blurAndSubmit" returnKeyType="done" placeholder="Title" placeholderTextColor={C.faint} accessibilityLabel="Title"
              className="flex-1 p-0 font-semi text-fg" style={{ fontSize: 22, textDecorationLine: done ? "line-through" : "none", opacity: done ? 0.5 : 1 }} />
          </View>
          <TaskNotes draft={notes} />
          <View>
            {task.checklist.map((i) => <Item key={i.id} taskId={id} id={i.id} />)}
            <AddItem taskId={id} />
          </View>
          <TaskTags taskId={id} />
        </View>

        <View className="mx-4 mt-4">
          <ListSection>
            <Prop icon={CalendarDays} label="When" value={whenLabel(task, today)} onPress={() => open("when")} />
            <Prop icon={Flag} label="Deadline" value={due?.text ?? null} tone={due?.late ? "warn" : undefined} onPress={() => open("deadline")} />
            <Prop icon={Repeat} label="Repeat" value={task.every ? everyLabel(task.every) : null} onPress={() => open("repeat")} />
            <Prop icon={Bell} label="Reminder" value={task.remind ? (task.when ? task.remind : `${task.remind}, needs a day`) : null} onPress={() => open("remind")} />
          </ListSection>
        </View>

        <View className="mx-4 mt-4">
          <LinkedNotes taskId={id} onAdd={() => open("note")} />
        </View>

        <View className="mx-4 mt-6">
          <Button variant="destructive" icon={Trash2} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); actions.onDelete(task); }}>Delete task</Button>
        </View>
      </ScrollView>
      {dialogs}
    </KeyboardAvoidingView>
  );
}
