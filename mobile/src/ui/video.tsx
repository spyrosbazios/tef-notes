// A YouTube video played in the app, from a YouTube link tapped in a note (ui/note.tsx openLink). The player sits in a
// page of its own with an https base address: YouTube refuses to embed in a page with no referrer, as the editor's
// file:// page is.
import { router } from "expo-router";
import { ExternalLink } from "lucide-react-native";
import { Linking, View } from "react-native";
import { WebView } from "react-native-webview";
import { youtubeEmbed, youtubeVideo } from "@/core/links";
import { IconButton, ScreenHeader, T } from "./ds";
import { goBack } from "./note";
import { useTheme } from "./use-theme";

const open = (url: string) => { Linking.openURL(url).catch(() => {}); };

const page = (src: string, bg: string) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:${bg}}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style>
<iframe src="${src}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;

export function VideoScreen({ url }: { url: string }) {
  const { C } = useTheme();
  const v = youtubeVideo(url);
  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title="Video" compact back={() => goBack()}
        actions={<IconButton label="Open in YouTube" icon={ExternalLink} onPress={() => open(url)} />} />
      {v ? (
        <View style={{ width: "100%", aspectRatio: 16 / 9 }}>
          <WebView source={{ html: page(youtubeEmbed(v), C.bg), baseUrl: "https://tefnotes.app/" }} allowsFullscreenVideo
            mediaPlaybackRequiresUserAction={false} allowsInlineMediaPlayback style={{ backgroundColor: "transparent" }}
            onShouldStartLoadWithRequest={(r) => r.url.startsWith("https://tefnotes.app") || r.url.startsWith("https://www.youtube") || r.url === "about:blank"} />
        </View>
      ) : <T tone="warn" size={14}>Not a YouTube video.</T>}
    </View>
  );
}

/** A YouTube link played in the app. */
export function openVideo(url: string) {
  router.push({ pathname: "/video", params: { url } });
}
