// A run of finished steps in an Ask turn (thoughts, searches, reads) folded into one line, so a busy turn reads as
// its answer and not as a column of rows. Open, it shows each step as it was.
import * as Haptics from "expo-haptics";
import { ChevronDown, ListChecks } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { T } from "./ds";
import { useTheme } from "./use-theme";

export function Steps({ summary, children }: { summary: string; children: ReactNode }) {
  const { C } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <Animated.View layout={LinearTransition}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => { Haptics.selectionAsync(); setOpen(!open); }}
        className="flex-row items-center gap-2 py-0.5 active:opacity-70">
        <ListChecks size={16} color={C.dim} />
        <T tone="dim" size={14} numberOfLines={1} className="flex-1">{summary}</T>
        <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}><ChevronDown size={16} color={C.dim} /></View>
      </Pressable>
      {open && (
        <Animated.View entering={FadeIn} exiting={FadeOut}>
          <View className="ms-2 mt-2 gap-2 border-s border-line ps-4">{children}</View>
        </Animated.View>
      )}
    </Animated.View>
  );
}
