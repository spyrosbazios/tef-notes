// The screen's one main action, floating at the bottom end: a 56dp brand square-ish button (Material's FAB), or
// `extended` with a word beside the icon. Lists under it need ~88dp of bottom padding to scroll clear of it.
// It settles in with a small scale from 0.8 on RN's own Animated (native driver), never a Reanimated entering: that one once
// failed to render, and a button that is always there must show whatever the animation does.
import * as Haptics from "expo-haptics";
import type { LucideIcon } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Animated, Easing, Pressable, View } from "react-native";
import { useTheme } from "../use-theme";
import { cn } from "./cn";
import { T } from "./text";

export function Fab({ icon: Icon, label, extended, onPress, className }: { icon: LucideIcon; label: string; extended?: boolean; onPress: () => void; className?: string }) {
  const { C } = useTheme();
  const [scale] = useState(() => new Animated.Value(0.8));
  useEffect(() => {
    Animated.timing(scale, { toValue: 1, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [scale]);
  return (
    <View className={cn("absolute bottom-4 right-4", className)}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
          className={cn("h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-brand active:opacity-85", extended ? "px-5" : "w-14")}
          style={{ elevation: 4 }}>
          <Icon size={24} color={C.bg} strokeWidth={2.6} />
          {extended && <T tone="bg" font="semi" size={15}>{label}</T>}
        </Pressable>
      </Animated.View>
    </View>
  );
}
