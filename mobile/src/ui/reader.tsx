// Reader view: a linked page as an article (hero picture, title, byline, body), fetched through the server's reader
// route (store/reader.ts). The body is drawn as a note's preview is, links and pictures included.
import { Image } from "expo-image";
import { ExternalLink } from "lucide-react-native";
import { ActivityIndicator, Linking, ScrollView, View } from "react-native";
import { EnrichedMarkdownText } from "react-native-enriched-markdown";
import { readingMinutes, type Article } from "@/core/reader";
import { readerError, useArticle } from "@/store/reader";
import { Button, IconButton, ScreenHeader, T } from "./ds";
import { bodyImages, FLAGS, goBack, openLink, openPhotos, useMarkdownStyle } from "./note";
import { useTheme } from "./use-theme";

const open = (url: string) => { Linking.openURL(url).catch(() => {}); };

/** "Site · Author · 2026-11-04 · 5 min read", whatever of it the page told. */
const byline = (a: Article) => [a.site, a.author, a.published, a.words ? `${readingMinutes(a.words)} min read` : ""].filter(Boolean).join(" · ");

function Body({ article }: { article: Article }) {
  const md = useMarkdownStyle();
  const line = byline(article);
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
      {article.image ? (
        <Image source={{ uri: article.image }} contentFit="cover" style={{ width: "100%", aspectRatio: 16 / 9 }} accessibilityLabel="Article picture" />
      ) : null}
      <View className="gap-2 px-5 pb-3 pt-4">
        <T variant="title" size={24} selectable>{article.title || article.site || article.url}</T>
        {line ? <T variant="caption" size={13}>{line}</T> : null}
      </View>
      <View className="px-5">
        <EnrichedMarkdownText flavor="github" markdown={article.markdown} markdownStyle={md} selectable md4cFlags={FLAGS}
          onImagePress={({ url }) => openPhotos(bodyImages(article.markdown), Math.max(0, bodyImages(article.markdown).indexOf(url)))}
          onLinkPress={({ url }) => openLink(url)} />
      </View>
    </ScrollView>
  );
}

export function ReaderScreen({ url }: { url: string }) {
  const { C } = useTheme();
  const { data, error, isPending } = useArticle(url);
  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title={data?.site || "Reader view"} compact back={() => goBack()}
        actions={<IconButton label="Open in browser" icon={ExternalLink} onPress={() => open(url)} />} />
      {data ? <Body article={data} /> : isPending && !error ? (
        <View className="items-center py-10"><ActivityIndicator color={C.brand} accessibilityLabel="Loading" /></View>
      ) : (
        <View className="items-start gap-3 px-5 py-4">
          <T tone="warn" size={14}>{readerError(error)}</T>
          <Button size="sm" variant="tonal" onPress={() => open(url)}>Open in browser</Button>
        </View>
      )}
    </View>
  );
}
