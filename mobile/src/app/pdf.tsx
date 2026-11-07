// A PDF attached to a note, opened by tapping its link (ui/note.tsx openLink) or its chip in the editor.
import { useLocalSearchParams } from "expo-router";
import { PdfScreen } from "@/ui/pdf";

export default function Pdf() {
  const { note, name } = useLocalSearchParams<{ note: string; name: string }>();
  return <PdfScreen noteId={note} name={name} />;
}
