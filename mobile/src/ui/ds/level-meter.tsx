// The microphone's loudness while recording: bars scrolling in from the right, each the level (0..1) at its moment.
import { useState } from "react";
import { View } from "react-native";
import { cn } from "./cn";

const BARS = 32;

export function LevelMeter({ level, height = 28, className }: { level: number; height?: number; className?: string }) {
  // Each new level pushes a bar in (adjusting state while rendering, React's pattern for state that follows a prop)
  const [seen, setSeen] = useState<{ level: number; history: number[] }>(() => ({ level, history: Array(BARS).fill(0) }));
  if (seen.level !== level) setSeen({ level, history: [...seen.history.slice(1), Math.max(0, Math.min(1, level))] });
  const { history } = seen;
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Recording level" className={cn("flex-row items-center justify-between", className)} style={{ height }}>
      {history.map((v, i) => (
        <View key={i} className="w-[3px] rounded-full bg-brand" style={{ height: Math.max(3, v * height), opacity: 0.35 + 0.65 * (i / BARS) }} />
      ))}
    </View>
  );
}
