// A screen's header: a 56dp bar (back, actions) over a large title that folds into the bar as the content scrolls.
// Give it the scroll position from `useCollapsingHeader()` (whose `onScroll` goes on an Animated scroll view);
// without one the large title just stays. `blur` lays a frosted ground behind the bar for content passing under it.
import { BlurView } from "expo-blur";
import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import Animated, { Extrapolation, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { alpha } from "@/core/theme";
import { useTheme } from "../use-theme";
import { IconButton } from "./button";
import { cn } from "./cn";
import { T } from "./text";

const BAR = 56, LARGE = 52;

/** The scroll position a ScreenHeader folds by, and the handler that feeds it. */
export function useCollapsingHeader() {
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => { scrollY.value = e.contentOffset.y; });
  return { scrollY, onScroll };
}

export type ScreenHeaderProps = {
  title: string;
  /** A line under the large title (a count, a date). */
  subtitle?: string;
  /** The subtitle's opacity (0..1) on the UI thread: a subtitle that belongs to some pages only fades with the swipe,
   *  its room kept, so the header never jumps. */
  subtitleShown?: SharedValue<number>;
  /** A back button: `true` goes back in the stack, a function does what it says. */
  back?: boolean | (() => void);
  /** Before the title in the bar (a logo), when there is no back button. */
  left?: ReactNode;
  /** IconButtons at the bar's end. */
  actions?: ReactNode;
  scrollY?: SharedValue<number>;
  /** Only the bar, the title in it from the start: screens that are a single form or a viewer. */
  compact?: boolean;
  blur?: boolean;
  /** Under the title, inside the header (tabs, a search field). */
  children?: ReactNode;
  className?: string;
};

export function ScreenHeader({ title, subtitle, subtitleShown, back, left, actions, scrollY, compact, blur, children, className }: ScreenHeaderProps) {
  const { C, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const zero = useSharedValue(0);
  const y = scrollY ?? zero;
  const large = useAnimatedStyle(() => ({
    height: interpolate(y.value, [0, LARGE], [LARGE + (subtitle ? 20 : 0), 0], Extrapolation.CLAMP),
    opacity: interpolate(y.value, [0, LARGE * 0.6], [1, 0], Extrapolation.CLAMP),
  }));
  // A bar holding nothing but the small title (no back, left or actions) stays shut until that title shows, so a
  // tab like Today doesn't open on 56dp of empty band above its large title.
  const bare = !back && !left && !actions && !compact;
  const bar = useAnimatedStyle(() => ({ height: bare ? interpolate(y.value, [0, LARGE], [8, BAR], Extrapolation.CLAMP) : BAR }));
  const shown = subtitleShown;
  const sub = useAnimatedStyle(() => ({ opacity: shown ? shown.value : 1 }));
  const small = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [LARGE * 0.5, LARGE], [0, 1], Extrapolation.CLAMP) }));
  const goBack = typeof back === "function" ? back : () => router.back();
  return (
    <View className={cn(!blur && "bg-bg", className)} style={{ paddingTop: insets.top }}>
      {blur && <BlurView tint={scheme} intensity={60} className="absolute inset-0" style={{ backgroundColor: alpha(C.bg, 0.8) }} />}
      <Animated.View className="flex-row items-center gap-1 overflow-hidden px-2" style={bar}>
        {back ? <IconButton label="Back" icon={ChevronLeft} size={26} onPress={goBack} /> : left ? <View className="pl-2">{left}</View> : <View className="w-2" />}
        <Animated.View style={compact ? undefined : small} className="flex-1 px-1">
          <T variant="heading" size={18} numberOfLines={1}>{title}</T>
        </Animated.View>
        {actions ? <View className="flex-row items-center">{actions}</View> : null}
      </Animated.View>
      {!compact && (
        <Animated.View style={large} className="overflow-hidden justify-end px-5">
          <T variant="display" numberOfLines={1}>{title}</T>
          {subtitle ? (
            <Animated.View style={sub}><T variant="caption" size={13} className="pb-1">{subtitle}</T></Animated.View>
          ) : null}
        </Animated.View>
      )}
      {children}
    </View>
  );
}
