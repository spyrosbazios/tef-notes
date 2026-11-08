// The sources an agent answer cited, under it on the phone: the number, the note or site, and the passage that backs the
// claim. The answer's own links are the citations (packages/core/src/citations.ts matches them) and carry their number
// inline (`annotate`); the native markdown renderer has no inline chips, so this list is where the phone shows what a
// page or note said.
import { ChevronDown } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { citeLink, type Citation } from "@/core/citations";
import { T } from "../ds";
import { openLink, openNote } from "../note";
import { useTheme } from "../use-theme";

/** A note (or the note a PDF hangs off) opens in the app; a page in the browser. */
const open = (c: Citation) => {
  if ((c.kind === "note" || c.kind === "pdf") && c.path) openNote(c.path);
  else openLink(c.url ?? citeLink(c));
};

export function Sources({ cited }: { cited: readonly Citation[] }) {
  const { C } = useTheme();
  const [openList, setOpenList] = useState(false);
  if (!cited.length) return null;
  return (
    <View className="gap-1">
      <Pressable onPress={() => setOpenList((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: openList }}
        className="flex-row items-center gap-2 self-start rounded-full bg-muted px-2.5 py-1.5">
        <T tone="dim" size={12} font="semi">{cited.length} source{cited.length === 1 ? "" : "s"}</T>
        <ChevronDown size={13} color={C.dim} style={{ transform: [{ rotate: openList ? "180deg" : "0deg" }] }} />
      </Pressable>
      {openList ? (
        <View className="gap-1">
          {cited.map((c) => (
            <Pressable key={c.href} onPress={() => open(c)} accessibilityRole="button" accessibilityLabel={`Source ${c.n}: ${c.title}`}
              className="flex-row items-start gap-2.5 rounded-xl border border-line bg-card px-3 py-2">
              <T tone="dim" size={12} font="num" className="w-3 text-right">{c.n}</T>
              <View className="flex-1 gap-0.5">
                <T size={14} font="medium" numberOfLines={1}>{c.title}</T>
                <T tone="dim" size={11}>{c.site}</T>
                {c.snippet ? <T tone="dim" size={12} numberOfLines={2} className="leading-4">{c.snippet}</T> : null}
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
