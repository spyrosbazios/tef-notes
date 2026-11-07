// A bottom sheet on React Native's Modal: sized to its content up to 90% of the screen, slid up with a spring, dragged
// down or tapped away, lifted over the keyboard. Controlled: `open` shows it, and `onOpenChange(false)` reports every
// way it closes. A Modal is its own window on Android, so it carries its own keyboard avoidance. Animated with React
// Native's own Animated, not Reanimated: Reanimated 4.5 on RN 0.86 can't find a Modal's surface to animate ("Unable to
// find SurfaceMountingManager"), which is also why @gorhom/bottom-sheet never showed.
import { useEffect, useState, type ReactNode } from "react";
import { Animated, Modal, PanResponder, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../use-theme";
import { cn } from "./cn";
import { T } from "./text";

export type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  /** Beside the title (an action). */
  right?: ReactNode;
  /** Content taller than the screen scrolls inside the sheet. */
  scroll?: boolean;
  className?: string;
  children: ReactNode;
};

const SPRING = { damping: 26, stiffness: 260, mass: 0.9, useNativeDriver: true };

export function Sheet({ open, onOpenChange, title, right, scroll, className, children }: SheetProps) {
  const { C, TINT } = useTheme();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [shown, setShown] = useState(open);   // stays mounted through the closing slide
  if (open && !shown) setShown(true);         // opening mounts it in the same render
  const [y] = useState(() => new Animated.Value(height)), [fade] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (open) {
      Animated.parallel([
        Animated.spring(y, { toValue: 0, ...SPRING }),
        Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    } else if (shown) {
      Animated.parallel([
        Animated.timing(y, { toValue: height, duration: 200, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 0, duration: 160, useNativeDriver: true }),
      ]).start(({ finished }) => { if (finished) setShown(false); });
    }
  }, [open, shown, height, y, fade]);

  const close = () => onOpenChange(false);
  const [dragged, setDragged] = useState(false);   // a drag past the line asks to close from the gesture's thread
  if (dragged && !open) setDragged(false);
  useEffect(() => { if (dragged) onOpenChange(false); }, [dragged, onOpenChange]);
  const [drag] = useState(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 8,
    onPanResponderMove: (_, g) => y.setValue(Math.max(0, g.dy)),
    onPanResponderRelease: (_, g) => {
      if (g.dy > 120 || g.vy > 0.9) setDragged(true);
      else Animated.spring(y, { toValue: 0, ...SPRING }).start();
    },
  }));

  const Body = scroll ? ScrollView : View;

  return (
    <Modal visible={shown} transparent statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={close}>
      <KeyboardAvoidingView behavior="padding" className="flex-1 justify-end">
          <Animated.View className="absolute inset-0" style={{ backgroundColor: TINT.scrim, opacity: fade }}>
            <Pressable className="flex-1" onPress={close} accessibilityRole="button" accessibilityLabel="Close" />
          </Animated.View>
          <Animated.View style={{ maxHeight: height * 0.9, backgroundColor: C.card, transform: [{ translateY: y }] }} className="rounded-t-[28px]">
            <View {...drag.panHandlers} className="items-center pb-2 pt-3">
              <View className="h-1 w-9 rounded-full" style={{ backgroundColor: C.faint }} />
            </View>
            <Body keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }} contentContainerStyle={scroll ? { paddingBottom: insets.bottom + 16 } : undefined}>
              {title != null && (
                <View className="flex-row items-center gap-3 px-5 pb-3 pt-1">
                  <T variant="title" className="flex-1" numberOfLines={1}>{title}</T>
                  {right}
                </View>
              )}
              <View className={cn("px-5", className)}>{children}</View>
              {scroll ? null : <View style={{ height: insets.bottom + 16 }} />}
            </Body>
          </Animated.View>
        </KeyboardAvoidingView>
    </Modal>
  );
}
