// A switch, Material-sized (52x32). Off is an outlined track with a smaller dim thumb, so it reads as "off" and not as
// missing on every ground; on is the brand track with a full thumb.
import * as Primitive from "@rn-primitives/switch";
import { useEffect } from "react";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { cn } from "./cn";

export type SwitchProps = {
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  className?: string;
};

export function Switch({ checked, onCheckedChange, disabled, accessibilityLabel, className }: SwitchProps) {
  const on = useSharedValue(checked ? 1 : 0);
  useEffect(() => { on.value = withTiming(checked ? 1 : 0, { duration: 160 }); }, [checked, on]);
  const thumb = useAnimatedStyle(() => ({
    transform: [{ translateX: on.value * 20 }, { scale: 0.7 + on.value * 0.3 }],
  }));
  return (
    <Primitive.Root checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} accessibilityLabel={accessibilityLabel}
      className={cn("h-8 w-[52px] justify-center rounded-full border-2 px-[2px]", checked ? "border-brand bg-brand" : "border-faint bg-raised",
        disabled && "opacity-45", className)}>
      <Animated.View style={thumb}>
        <Primitive.Thumb className={cn("h-6 w-6 rounded-full", checked ? "bg-bg" : "bg-dim")} />
      </Animated.View>
    </Primitive.Root>
  );
}
