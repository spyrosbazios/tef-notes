// A link card's page read as an article, opened by its "Reader view" button in the editor (ui/note.tsx openReader).
import { useLocalSearchParams } from "expo-router";
import { ReaderScreen } from "@/ui/reader";

export default function Reader() {
  const { url } = useLocalSearchParams<{ url: string }>();
  return <ReaderScreen url={url} />;
}
