// Choosing one of a few: a SegmentedControl is a pill track with the choice raised (2–4 short labels, fills its row);
// Tabs is a row of underlined labels that scrolls sideways when it outgrows the screen, so none fall off the edge, and
// keeps the chosen one in view. Given a `position` (a pager's scroll position as a fractional page index) the underline is
// one bar that follows it, so it slides with a swipe; without one each tab draws its own underline.
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View, type LayoutChangeEvent } from "react-native";
import Animated, { Extrapolation, interpolate, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { cn } from "./cn";
import { T } from "./text";

export type Option<K extends string> = { key: K; label: string; count?: number };

export function SegmentedControl<K extends string>({ options, value, onChange, className }: { options: Option<K>[]; value: K; onChange: (k: K) => void; className?: string }) {
  return (
    <View accessibilityRole="tablist" className={cn("h-11 flex-row rounded-full bg-muted p-1", className)}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} accessibilityRole="tab" accessibilityState={{ selected: on }}
            onPress={() => { if (!on) { void Haptics.selectionAsync(); onChange(o.key); } }}
            className={cn("flex-1 items-center justify-center rounded-full", on && "bg-raised")}>
            <T tone={on ? "fg" : "dim"} font={on ? "semi" : "medium"} size={14} numberOfLines={1}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

type Box = { x: number; w: number };

/** The underline as one bar between the tabs' boxes, at `position` (0 = the first tab, 1.5 = halfway from second to third). */
function Underline({ boxes, position }: { boxes: Box[]; position: SharedValue<number> }) {
  // Plain arrays, made here: a callback (`.map(fn)`) inside the worklet is a JS function the UI thread can't call,
  // and calling it there kills the app ("Tried to synchronously call a Remote Function").
  const at = boxes.map((_, i) => i), xs = boxes.map((b) => b.x), ws = boxes.map((b) => b.w);
  const bar = useAnimatedStyle(() => {
    if (xs.length < 2) return { transform: [{ translateX: xs[0] ?? 0 }], width: ws[0] ?? 0 };
    return {
      transform: [{ translateX: interpolate(position.value, at, xs, Extrapolation.CLAMP) }],
      width: interpolate(position.value, at, ws, Extrapolation.CLAMP),
    };
  });
  return <Animated.View pointerEvents="none" className="absolute bottom-0 left-0 h-0.5 bg-brand" style={bar} />;
}

export function Tabs<K extends string>({ options, value, onChange, position, className }: {
  options: Option<K>[]; value: K; onChange: (k: K) => void;
  /** A pager's position as a fractional page index, one page per option: the underline follows it. */
  position?: SharedValue<number>; className?: string;
}) {
  const scroller = useRef<ScrollView>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [viewW, setViewW] = useState(0);
  const box = (i: number) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    setBoxes((b) => (b[i]?.x === x && b[i]?.w === width ? b : Object.assign([...b], { [i]: { x, w: width } })));
  };
  // The chosen tab stays in view, centred when it can be, also when a swipe (not a tap) chose it
  const at = options.findIndex((o) => o.key === value);
  useEffect(() => {
    const b = boxes[at];
    if (b && viewW) scroller.current?.scrollTo({ x: Math.max(0, b.x + b.w / 2 - viewW / 2), animated: true });
  }, [at, boxes, viewW]);
  return (
    <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} className={cn("grow-0", className)} contentContainerClassName="gap-1 px-4"
      accessibilityRole="tablist" onLayout={(e) => setViewW(e.nativeEvent.layout.width)}>
      {options.map((o, i) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onLayout={box(i)}
            onPress={() => { if (!on) { void Haptics.selectionAsync(); onChange(o.key); } }}
            className={cn("h-12 flex-row items-center gap-1.5 border-b-2 px-3", on && !position ? "border-brand" : "border-transparent")}>
            <T tone={on ? "fg" : "dim"} font={on ? "semi" : "medium"} size={15}>{o.label}</T>
            {o.count ? <T tone={on ? "brand" : "faint"} font="num" size={12}>{o.count}</T> : null}
          </Pressable>
        );
      })}
      {position && boxes.length === options.length ? <Underline boxes={boxes} position={position} /> : null}
    </ScrollView>
  );
}
