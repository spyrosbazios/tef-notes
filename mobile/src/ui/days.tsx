// Home's days, over the task box: the phone's form of the web's month planner (web/src/components/planned.tsx), a strip of
// days scrolled sideways past one fixed slot in the middle. Whatever day sits in the slot is the day the task box shows
// (Today's list for today, Upcoming's day for a later one): drag the strip to put a day there, or tap a day and it slides
// in; and the box's `day` (Upcoming scrolled by hand to a day's section) slides the strip to it, so the two stay in step. Each day is shaded by how many open tasks are planned for it or due on it, inside the lens that is on (the days and
// counts: @/core/planner). A long press adds a task planned for that day. Past days stay faint and take neither: a drag that
// leaves one in the slot settles back on today. Over the strip: the slot's month (back to today is the box's Today). The slot is drawn by the day in it (its border lights as it arrives, the brand once it is the box's day), today
// by its number in the brand. The strip is a week behind today to half a year ahead. Shades: the brand at 1, 2, 3, 4 or more.
import * as Haptics from "expo-haptics";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import Animated, { Extrapolation, interpolate, interpolateColor, runOnJS, useAnimatedReaction, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";
import { addDays, daysBetween } from "@/core/dates";
import { dayDate, dayRange, plannedByDay, shadeOf, WEEKDAYS } from "@/core/planner";
import { alpha } from "@/core/theme";
import { useTasks } from "@/store/todo";
import { T } from "./ds";
import { useTheme } from "./use-theme";

const BEHIND = 7, AHEAD = 183;
const CELL = 52, GAP = 6, STEP = CELL + GAP, HEIGHT = 56, ROOM = 5; // ROOM: above and below, for the slot's day as it grows

const monthOf = (day: string, today: string) =>
  dayDate(day).toLocaleDateString(undefined, day.slice(0, 4) === today.slice(0, 4) ? { month: "long" } : { month: "long", year: "numeric" });

/** One day of the strip: it grows as it nears the slot and fades as it leaves (`x` is the strip's offset, `i` its place). The
 *  worklet runs for every mounted day on every frame of a scroll, so a day far from the slot is answered in one comparison. */
const Day = memo(function Day({ day, i, x, n, today, picked, onPick, onAdd }: {
  day: string; i: number; x: SharedValue<number>; n: number; today: string; picked: boolean; onPick: (day: string) => void; onAdd: (day: string) => void;
}) {
  const { C } = useTheme();
  const shade = [alpha(C.fg, 0.05), alpha(C.brand, 0.2), alpha(C.brand, 0.4), alpha(C.brand, 0.65), C.brand];
  const past = day < today, on = day === today;
  const ink = n >= 3 ? C.bg : on ? C.brand : C.dim;
  const ring = picked ? C.brand : alpha(C.fg, 0.3);
  const near = useAnimatedStyle(() => {
    const d = Math.abs(x.value / STEP - i);
    if (d >= 4) return { transform: [{ scale: 0.86 }], opacity: past ? 0.35 : 0.55, borderColor: "transparent" };
    return {
      transform: [{ scale: interpolate(d, [0, 1, 3], [1.1, 0.94, 0.86], Extrapolation.CLAMP) }],
      opacity: past ? 0.35 : interpolate(d, [0, 1, 4], [1, 0.85, 0.55], Extrapolation.CLAMP),
      borderColor: d < 0.6 ? interpolateColor(d, [0, 0.6], [ring, "transparent"]) : "transparent",
    };
  });
  return (
    <Animated.View className="rounded-xl" style={[{ width: CELL, height: HEIGHT, marginRight: GAP, borderWidth: 2 }, near]}>
      <Pressable disabled={past} onPress={() => { void Haptics.selectionAsync(); onPick(day); }}
        onLongPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onAdd(day); }} delayLongPress={350}
        accessibilityRole="button" accessibilityState={{ selected: picked }}
        accessibilityLabel={`${dayDate(day).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}, ${n} planned`}
        accessibilityHint={past ? undefined : "Shows its tasks. Press and hold to add one that day"}
        className="flex-1 items-center justify-center rounded-[10px] active:opacity-70"
        style={{ backgroundColor: shade[shadeOf(n)] }}>
        <T font="medium" size={11} style={{ color: ink, opacity: 0.8 }}>{WEEKDAYS[(dayDate(day).getDay() + 6) % 7]}</T>
        <T font={on ? "num-bold" : "num"} size={17} style={{ color: ink }}>{Number(day.slice(8))}</T>
      </Pressable>
    </Animated.View>
  );
});

/** `day`: the day the task box shows (null while it shows the Inbox); the strip slides it into the slot. */
export function Days({ today, day: picked, onPick, onAdd }: { today: string; day: string | null; onPick: (day: string) => void; onAdd: (day: string) => void }) {
  const { C } = useTheme();
  // The callbacks as the days see them never change, so a Home render leaves every mounted day alone
  const cb = useRef({ onPick, onAdd });
  useEffect(() => { cb.current = { onPick, onAdd }; }, [onPick, onAdd]);
  const pickDay = useCallback((d: string) => cb.current.onPick(d), []);
  const addDay = useCallback((d: string) => cb.current.onAdd(d), []);
  const tasks = useTasks();
  const days = useMemo(() => dayRange(addDays(today, -BEHIND), BEHIND + AHEAD), [today]);
  const byDay = useMemo(() => plannedByDay(tasks), [tasks]);
  const [width, setWidth] = useState(0);
  const pad = (width - CELL) / 2;
  const list = useRef<Animated.FlatList<string>>(null);

  // The strip's offset, read by every day; the day in the slot, followed live for the month's name, with a tick per day
  // passed while the owner drags (not while the strip slides to a day on its own)
  const x = useSharedValue(BEHIND * STEP);
  const dragging = useSharedValue(false);
  const [slot, setSlot] = useState(today);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => { x.value = e.contentOffset.x; },
    onBeginDrag: () => { dragging.value = true; },
    onMomentumEnd: () => { dragging.value = false; },
  });
  const slide = useCallback((day: string) => {
    list.current?.scrollToIndex({ index: Math.min(days.length - 1, Math.max(0, daysBetween(days[0], day))), animated: true });
  }, [days]);
  const onSlot = (i: number, tick: boolean) => { setSlot(days[i]); if (tick) void Haptics.selectionAsync(); };
  useAnimatedReaction(() => Math.min(days.length - 1, Math.max(0, Math.round(x.value / STEP))), (i, was) => { if (i !== was && was !== null) runOnJS(onSlot)(i, dragging.value); });

  // The day the strip settled on becomes the box's; a past one settles back on today. The box's day, however it came to be
  // (a tap on a day or the arrow, the box's own words, Upcoming scrolled by hand), slides into the slot; a settle on it then
  // finds it the box's already.
  const shown = useRef(picked);
  useEffect(() => { shown.current = picked; }, [picked]);
  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const day = days[Math.min(days.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.x / STEP)))];
    if (day < today) slide(today);
    else if (day !== shown.current) onPick(day);
  };
  useEffect(() => { if (picked) slide(picked); }, [picked, slide]);

  return (
    <View className="mx-3" accessibilityLabel="The days' plan">
      <T tone="faint" font="medium" size={11} className="text-center" style={{ height: 18 }}>{monthOf(slot, today)}</T>
      <View className="relative" style={{ height: HEIGHT + 2 * ROOM }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width ?
          <Animated.FlatList ref={list} data={days} horizontal showsHorizontalScrollIndicator={false} keyExtractor={(d) => d}
            onScroll={onScroll} scrollEventThrottle={16} onMomentumScrollEnd={settle}
            onScrollEndDrag={(e) => { if (Math.abs(e.nativeEvent.contentOffset.x % STEP) < 1) settle(e); }}
            snapToInterval={STEP} decelerationRate="fast"
            initialScrollIndex={BEHIND} getItemLayout={(_, i) => ({ length: STEP, offset: STEP * i, index: i })}
            contentContainerStyle={{ paddingLeft: pad, paddingRight: pad - GAP, paddingVertical: ROOM }} initialNumToRender={16} windowSize={3} maxToRenderPerBatch={8} removeClippedSubviews
            renderItem={({ item, index }) => <Day day={item} i={index} x={x} n={byDay.get(item)?.length ?? 0} today={today} picked={item === picked} onPick={pickDay} onAdd={addDay} />} />
          : null}
        {/* The strip's edges fade into the page rather than cutting a day in half */}
        <View pointerEvents="none" className="absolute inset-y-0 left-0 w-7" style={{ experimental_backgroundImage: `linear-gradient(to right, ${C.bg}, transparent)` }} />
        <View pointerEvents="none" className="absolute inset-y-0 right-0 w-7" style={{ experimental_backgroundImage: `linear-gradient(to left, ${C.bg}, transparent)` }} />
      </View>
    </View>
  );
}
