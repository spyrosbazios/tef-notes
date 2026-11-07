// A YouTube link tapped in a note, played in the app (ui/note.tsx openLink).
import { useLocalSearchParams } from "expo-router";
import { VideoScreen } from "@/ui/video";

export default function Video() {
  const { url } = useLocalSearchParams<{ url: string }>();
  return <VideoScreen url={url} />;
}
