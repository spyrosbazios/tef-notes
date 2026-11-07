// The model's thinking as a folded row: "Thinking…" (pulsing) while it streams, "Thought for 4 seconds" after; the
// text opens under it. A thought with no text has nothing to open.
import * as Haptics from "expo-haptics";
import { Sparkles } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { Chevron, FOLD } from "./chevron";
import { T } from "../ds";
import { useTheme } from "../use-theme";
import { Pulse } from "./pulse";

export function Reasoning({ text, streaming = false }: { text?: string; streaming?: boolean }) {
  const { C } = useTheme();
  const [open, setOpen] = useState(false);
  const [seconds, setSeconds] = useState<number>();
  const since = useRef<number | null>(null);
  useEffect(() => {
    if (streaming) since.current ??= Date.now();
    else if (since.current !== null) { setSeconds(Math.max(1, Math.round((Date.now() - since.current) / 1000))); since.current = null; }
  }, [streaming]);
  const label = streaming ? "Thinking…" : seconds === undefined ? "Thought for a few seconds" : `Thought for ${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  return (
    <Animated.View layout={LinearTransition.duration(FOLD)}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} disabled={!text}
        onPress={() => { Haptics.selectionAsync(); setOpen(!open); }} className="flex-row items-center gap-2 py-0.5 active:opacity-70">
        <Sparkles size={16} color={C.dim} />
        <View className="flex-1 flex-row"><Pulse active={streaming}><T tone="dim" size={14}>{label}</T></Pulse></View>
        {text ? <Chevron open={open} /> : null}
      </Pressable>
      {open && text ? (
        <Animated.View entering={FadeIn.duration(FOLD)} exiting={FadeOut.duration(FOLD / 2)} className="ms-2 mt-2 border-s border-line ps-4">
          <T tone="dim" size={14} className="leading-[22px]">{text}</T>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}
