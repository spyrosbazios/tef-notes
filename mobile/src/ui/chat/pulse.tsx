// A slow fade in and out for something still going on (a thought, a tool call, the dots). Still when the phone is set to
// reduce motion.
import { useEffect, type ReactNode } from "react";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

export function Pulse({ active = true, delay = 0, children }: { active?: boolean; delay?: number; children: ReactNode }) {
  const reduced = useReducedMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    if (!active || reduced) { o.value = 1; return; }
    const t = setTimeout(() => { o.value = withRepeat(withTiming(0.35, { duration: 700, easing: Easing.inOut(Easing.ease) }), -1, true); }, delay);
    return () => clearTimeout(t);
  }, [active, reduced, delay, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={style}>{children}</Animated.View>;
}
