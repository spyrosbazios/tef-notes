// The arrow on a folded row (a tool call, a thought): it turns with the fold rather than flipping.
import { ChevronDown } from "lucide-react-native";
import { useEffect } from "react";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useTheme } from "../use-theme";

export const FOLD = 180;                              // ms: a fold opening; it closes in half that

/** The fold's chevron turns with the fold rather than flipping. */
export function Chevron({ open }: { open: boolean }) {
  const { C } = useTheme();
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => { turn.set(withTiming(open ? 1 : 0, { duration: FOLD, easing: Easing.out(Easing.cubic) })); }, [open, turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 180}deg` }] }));
  return <Animated.View style={style}><ChevronDown size={16} color={C.dim} /></Animated.View>;
}

