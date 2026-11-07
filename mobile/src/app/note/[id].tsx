// One note, by id (its filename): from the list, Home, or a link in an Ask answer. `fresh=1`: a note just made, opened with
// its title field taking the keyboard. A note made here that went up under another name (the laptop had
// taken its own) is followed there.
import { useLocalSearchParams } from "expo-router";
import { NOTES } from "@/core/notes";
import { useNotes } from "@/store/notes";
import { NoteScreen } from "@/ui/note";

export default function NoteRoute() {
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const path = useNotes((s) => s.list.find((n) => n.id === id)?.path ?? s.moved[`${NOTES}${id}.md`]) ?? `${NOTES}${id}.md`;
  return <NoteScreen key={path} path={path} fresh={fresh === "1"} />;
}
