// A note as a tile, shared by Home's two views of the notes (flat and grouped by tag) and the search: its picture across the top, the title, the
// opening prose, tags, then pin and age; a search hit shows its snippet instead.
import * as Haptics from "expo-haptics";
import { Check, CloudOff, Pin, TriangleAlert } from "lucide-react-native";
import { memo } from "react";
import { View } from "react-native";
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from "react-native-reanimated";
import { snippetParts } from "@/core/notes";
import { ago } from "@/core/time";
import type { NoteMeta } from "@/store/notes";
import { PressScale, T } from "./ds";
import { TagRow } from "./tags";
import { NoteThumb } from "./thumb";
import { alpha } from "@/core/theme";
import { useTheme } from "./use-theme";

/** A search hit's snippet with the matched words in bold. */
export function Hit({ s, color }: { s: string; color?: string }) {
  return (
    <T tone="dim" size={13} numberOfLines={6} style={color ? { color } : undefined}>
      {snippetParts(s).map((p, i) => (p.hit ? <T key={i} font="semi" size={13} style={color ? { color } : undefined}>{p.text}</T> : p.text))}
    </T>
  );
}

/** A note as a tile: its picture across the top, the title (two lines), the opening prose (a few), tags, then pin and age.
 *  A note with a colour wears it as the card's tint (bg, ink, line). While notes are selected (`selecting`) a tap toggles instead of opening. */
export const NoteTile = memo(function NoteTile({ n, hit, now, local, selecting, selected, onPress, onLong }: {
  n: NoteMeta; hit?: string; now: number; local: boolean; selecting: boolean; selected: boolean; onPress: (path: string) => void; onLong: (path: string) => void;
}) {
  const { C, NOTE_COLORS } = useTheme();
  const P = n.color ? NOTE_COLORS[n.color] : null;
  const fg = P?.fg, dim = P?.line;
  // Unsent means nothing while there's no server to send to: the header says "on this phone only" once
  const state = n.conflict ? "conflict" : n.dirty && !local ? "not sent yet" : null;
  return (
    <PressScale onPress={() => onPress(n.path)} onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onLong(n.path); }}
      accessibilityRole={selecting ? "checkbox" : "button"} accessibilityState={selecting ? { checked: selected } : undefined} accessibilityLabel={state ? `${n.title}, ${state}` : n.title}
      accessibilityHint={selecting ? undefined : "Long press to select"}
      containerClassName="p-1" className="overflow-hidden rounded-2xl border"
      style={{ backgroundColor: P?.bg ?? C.card, borderColor: P ? alpha(P.line, 0.3) : C.line }}>
      {selected ? (
        <>
          <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(100)} pointerEvents="none"
            className="absolute inset-0 z-10 rounded-2xl border-2" style={{ borderColor: C.brand }} />
          <Animated.View entering={ZoomIn.duration(160)} exiting={ZoomOut.duration(100)}
            className="absolute top-2.5 right-2.5 z-10 h-6 w-6 items-center justify-center rounded-full" style={{ backgroundColor: C.brand }}>
            <Check size={14} color={C.bg} strokeWidth={3} />
          </Animated.View>
        </>
      ) : null}
      <NoteThumb id={n.id} path={n.path} updated={n.updated} />
      <View className="gap-2 p-3.5">
        <T font="semi" size={15} numberOfLines={2} className="leading-5" style={fg ? { color: fg } : undefined}>{n.title}</T>
        {hit ? <Hit s={hit} color={fg} /> : n.snippet
          ? <T tone="dim" size={13} numberOfLines={5} className="leading-[18px]" style={fg ? { color: fg, opacity: 0.8 } : undefined}>{n.snippet}</T>
          : null}
        <TagRow tags={n.tags} max={2} />
        <View className="flex-row items-center gap-1.5">
          {n.pinned ? <Pin size={12} color={dim ?? C.dim} /> : null}
          <T tone="faint" size={11} className="flex-1" style={dim ? { color: dim } : undefined}>{ago(n.updated, now)}</T>
          {n.conflict ? <TriangleAlert size={13} color={C.warn} accessibilityLabel="Conflict" />
            : state ? <CloudOff size={13} color={dim ?? C.dim} accessibilityLabel="Not sent yet" /> : null}
        </View>
      </View>
    </PressScale>
  );
});
