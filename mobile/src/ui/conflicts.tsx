// Notes both sides changed where the edits overlap, so no merge: the user picks a side. Then, until
// dismissed, the text "Use the server's" replaced can be put back. agent/ and strategies/ have no screen of
// their own, so Settings lists every one; a note's own screen shows just its banner.
import { View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { useNotes } from "@/store/notes";
import { Banner, Button, T } from "./ds";

/** Paths waiting on a decision: a side to pick, or replaced text to restore or dismiss. */
export const useConflicts = () => useNotes(useShallow((s) => Object.keys(s.notes).filter((p) => s.notes[p].conflict || s.notes[p].lost != null)));

export function ConflictBanner({ path, label, className = "mx-4 mb-3 w-auto" }: { path: string; label?: boolean; className?: string }) {
  const note = useNotes((s) => s.notes[path]);
  const { keepMine, takeTheirs, restore, discard } = useNotes.getState();
  if (!note?.conflict && note?.lost == null) return null;
  const [a, b] = note.conflict
    ? [{ t: "Keep mine", on: () => keepMine(path) }, { t: "Use the server's", on: () => takeTheirs(path) }]
    : [{ t: "Restore mine", on: () => restore(path) }, { t: "Dismiss", on: () => discard(path) }];
  return (
    <Banner variant="warning" className={className}
      title={note.conflict ? "This note changed on the server while you had unsent edits here." : "The server's version replaced your unsent edits here."}>
      {label && <T variant="caption" numberOfLines={1}>{path}</T>}
      <View className="flex-row gap-2">
        <Button size="sm" className="flex-1" onPress={a.on}>{a.t}</Button>
        <Button size="sm" variant="tonal" className="flex-1" onPress={b.on}>{b.t}</Button>
      </View>
    </Banner>
  );
}

/** Every note waiting on a decision, each with its path; nothing when there are none. */
export function Conflicts() {
  return <>{useConflicts().map((p) => <ConflictBanner key={p} path={p} label className="mb-2 w-auto" />)}</>;
}
