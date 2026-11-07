// A pressable tile that sinks a little under the finger and springs back (Reanimated, on the UI thread): note
// tiles. `className` styles the pressable itself (the tile); `containerClassName` the scaling wrapper around it, for
// layout (a masonry cell's padding). Rows use Touchable, which only dims.
import { Pressable, type PressableProps } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";

export type PressScaleProps = PressableProps & { className?: string; containerClassName?: string; scaleTo?: number };

export function PressScale({ className, containerClassName, scaleTo = 0.97, onPressIn, onPressOut, ...p }: PressScaleProps) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={style} className={containerClassName}>
      <Pressable {...p} className={className}
        onPressIn={(e) => { scale.set(withTiming(scaleTo, { duration: 90 })); onPressIn?.(e); }}
        onPressOut={(e) => { scale.set(withSpring(1, { damping: 14, stiffness: 320 })); onPressOut?.(e); }} />
    </Animated.View>
  );
}
