// A line in the transcript that isn't a message: an icon and a few words ("Thinking…"), pulsing while it is true.
// ThinkingDots is the small indicator the reply is on its way.
import type { ReactNode } from "react";
import { View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { T } from "../ds";
import { Pulse } from "./pulse";

export function ThinkingDots() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Thinking" className="flex-row items-center gap-[3px]">
      {[0, 1, 2].map((i) => (
        <Pulse key={i} delay={i * 180}><View className="h-1.5 w-1.5 rounded-full bg-dim" /></Pulse>
      ))}
    </View>
  );
}

/** It fades in when the wait starts and out when the first words land, rather than blinking. */
export function Marker({ icon, pulse, children }: { icon?: ReactNode; pulse?: boolean; children: string }) {
  return (
    <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} className="flex-row items-center gap-2 py-0.5">
      {icon}
      <Pulse active={!!pulse}><T tone="dim" size={14}>{children}</T></Pulse>
    </Animated.View>
  );
}
