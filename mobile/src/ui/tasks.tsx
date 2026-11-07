// A task as a row, Things-style: a round box that fills with a small pop, the title, and under it small grey text
// (the checklist's count, a reminder, a repeat) with the deadline in `warn`, then its tags as small badges. The box ticks (the row
// fades, then leaves: store/ticks.ts); a swipe right asks When, a swipe left shows Delete (it asks first,
// in the screen's dialog); a tap opens the task (route `task/[id]`, src/app/task/[id].tsx); a long press picks the row
// up when it sits in a reorderable list (`DragRow`).
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { Bell, Check, Flag, ListChecks, NotebookText, Repeat, Star, Trash2 } from "lucide-react-native";
import { memo, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import Swipeable, { SwipeDirection, type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { NestedReorderableList, useReorderableDrag } from "react-native-reorderable-list";
import Animated, {
  Extrapolation, FadeIn, FadeOut, interpolate, interpolateColor, LinearTransition, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { dayLabel, everyLabel } from "@/core/dates";
import { notesOfTask } from "@/core/record-links";
import { dueLabel, progress } from "@/core/things";
import type { Task } from "@/core/todo";
import { toggleTask } from "@/store/ticks";
import { useTodo } from "@/store/todo";
import { cn, T } from "./ds";
import { TagRow } from "./tags";
import { reorder } from "@/core/task-order";
import { useTheme } from "./use-theme";

/** The task's own screen. */
export const openTask = (id: string) => router.push({ pathname: "/task/[id]", params: { id } });

/** The Tasks tab's lists, in its pager's order. */
export const TASK_LISTS = [
  { key: "inbox", label: "Inbox" }, { key: "today", label: "Today" }, { key: "upcoming", label: "Upcoming" },
  { key: "logbook", label: "Logbook" },
] as const;
export type TaskListKey = (typeof TASK_LISTS)[number]["key"];

/** The Tasks tab, paged to `list` (its `list` param, which the tab takes and clears). */
export const openTaskList = (list: TaskListKey) => router.navigate({ pathname: "/today", params: { list } });

/** The round box of a task or a checklist item. Controlled: `done` is what the caller shows, `onPress` toggles it. Ticking
 *  draws the brand fill in, pops the ring and sets a hard tap under the finger; unticking is a softer one. */
export function Box({ done, onPress, label, size = 24 }: { done: boolean; onPress: () => void; label: string; size?: number }) {
  const { C } = useTheme();
  const fill = useSharedValue(done ? 1 : 0), pop = useSharedValue(1);
  const was = useRef(done);
  useEffect(() => {
    fill.value = withTiming(done ? 1 : 0, { duration: 200 });
    if (done && !was.current) pop.value = withSequence(withTiming(1.25, { duration: 90 }), withSpring(1, { damping: 7, stiffness: 280 }));
    was.current = done;
  }, [done, fill, pop]);
  const ring = useAnimatedStyle(() => ({
    transform: [{ scale: pop.value }],
    borderColor: interpolateColor(fill.value, [0, 1], [C.faint, C.brand]),
  }));
  const disc = useAnimatedStyle(() => ({ opacity: fill.value, transform: [{ scale: interpolate(fill.value, [0, 1], [0.3, 1], Extrapolation.CLAMP) }] }));
  const tick = useAnimatedStyle(() => ({ opacity: fill.value, transform: [{ scale: interpolate(fill.value, [0, 1], [0.4, 1], Extrapolation.CLAMP) }] }));
  const pad = Math.max(0, (48 - size) / 2);
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: done }} accessibilityLabel={label} hitSlop={pad}
      onPress={() => { void Haptics.impactAsync(done ? Haptics.ImpactFeedbackStyle.Soft : Haptics.ImpactFeedbackStyle.Medium); onPress(); }}>
      <Animated.View className="items-center justify-center overflow-hidden rounded-full border-2" style={[{ width: size, height: size }, ring]}>
        <Animated.View className="absolute inset-0 rounded-full bg-brand" style={disc} />
        <Animated.View style={tick}><Check size={size * 0.62} color={C.bg} strokeWidth={3.4} /></Animated.View>
      </Animated.View>
    </Pressable>
  );
}

/** When, drawn behind the row on a swipe right: the icon grows with the drag. */
function WhenSide({ progress: p }: { progress: SharedValue<number> }) {
  const { C } = useTheme();
  const grow = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 0.6], [0, 1], Extrapolation.CLAMP), transform: [{ scale: interpolate(p.value, [0, 1], [0.6, 1], Extrapolation.CLAMP) }] }));
  return (
    <View className="w-24 items-center justify-center bg-accent">
      <Animated.View style={grow} className="items-center gap-1">
        <Star size={22} color={C.brand} />
        <T size={11} font="semi" tone="brand">When</T>
      </Animated.View>
    </View>
  );
}

const Action = ({ icon, label, className, onPress }: { icon: ReactNode; label: string; className: string; onPress: () => void }) => (
  <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} className={cn("w-20 items-center justify-center gap-1", className)}>
    {icon}
    <T size={11} font="semi" tone="bg">{label}</T>
  </Pressable>
);

export type RowActions = { onWhen: (t: Task) => void; onDelete: (t: Task) => void };

/** `ticking`: ticked and waiting to leave, so drawn done. `today` is the local day. `onLongPress`: picks the row up (only inside a reorderable list, whose cell animates
 *  the layout; a loose row animates its own). */
export const TaskRow = memo(function TaskRow({ task, today, ticking, onWhen, onDelete, onLongPress, ground = "bg-bg" }: {
  task: Task; today: string; ticking: boolean; onLongPress?: () => void;
  /** The row's own fill (it covers the swipe actions): the surface the list sits on. */
  ground?: string;
} & RowActions) {
  const { C } = useTheme();
  const swipe = useRef<SwipeableMethods>(null);
  const done = !!task.done || ticking;
  const due = task.due && !task.done ? dueLabel(task.due, today) : null;
  const small = task.done ? `Done ${dayLabel(task.done, today)}` : null;
  const count = progress(task);
  const linked = useTodo((s) => notesOfTask(s.links, task.id).length > 0);
  const faded = useAnimatedStyle(() => ({ opacity: withTiming(done ? 0.5 : 1, { duration: 220 }) }), [done]);

  const opened = (d: SwipeDirection.LEFT | SwipeDirection.RIGHT) => {
    if (d !== SwipeDirection.RIGHT) return;
    swipe.current?.close();
    Haptics.selectionAsync();
    onWhen(task);
  };
  const act = (f: (t: Task) => void) => () => { swipe.current?.close(); Haptics.selectionAsync(); f(task); };

  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(220)} layout={onLongPress ? undefined : LinearTransition}>
      <Swipeable ref={swipe} friction={2} overshootLeft={false} overshootRight={false} leftThreshold={64} rightThreshold={56} onSwipeableOpen={opened}
        renderLeftActions={(p) => <WhenSide progress={p} />}
        renderRightActions={() => (
          <Action icon={<Trash2 size={20} color={C.bg} />} label="Delete" className="bg-down" onPress={act(onDelete)} />
        )}>
        <Animated.View style={faded} className={cn("flex-row items-start gap-3.5 px-5 py-3", ground)}>
          <View className="mt-px"><Box done={done} onPress={() => toggleTask(task.id)} label={task.title} /></View>
          <Pressable onPress={() => openTask(task.id)} onLongPress={onLongPress} delayLongPress={300} accessibilityRole="button"
            accessibilityHint={onLongPress ? "Opens the task. Press and hold to move it" : "Opens the task"} className="flex-1 gap-1 active:opacity-70">
            <T size={16} font="medium" className="flex-shrink" style={done ? { color: C.dim, textDecorationLine: "line-through" } : undefined}>{task.title}</T>
            {small || due || task.remind || task.every || count || linked ? (
              <View className="flex-row flex-wrap items-center gap-x-3 gap-y-0.5">
                {count ? (
                  <View className="flex-row items-center gap-1" accessibilityLabel={`${count[0]} of ${count[1]} ticked`}>
                    <ListChecks size={11} color={C.dim} />
                    <T tone="dim" size={12} font="num">{count[0]}/{count[1]}</T>
                  </View>
                ) : null}
                {small ? <T tone="dim" size={12} numberOfLines={1}>{small}</T> : null}
                {due ? (
                  <View className="flex-row items-center gap-1">
                    <Flag size={11} color={C.warn} />
                    <T tone="warn" size={12} font="semi">{due.text}</T>
                  </View>
                ) : null}
                {task.remind && !task.done ? (
                  <View className="flex-row items-center gap-1">
                    <Bell size={11} color={C.dim} />
                    <T tone="dim" size={12} font="num">{task.remind}</T>
                  </View>
                ) : null}
                {task.every && !task.done ? (
                  <View className="flex-row items-center gap-1">
                    <Repeat size={11} color={C.dim} />
                    <T tone="dim" size={12}>{everyLabel(task.every)}</T>
                  </View>
                ) : null}
                {linked ? <NotebookText size={11} color={C.dim} /> : null}
              </View>
            ) : null}
            <TagRow tags={task.tags} onPress={() => openTask(task.id)} />
          </Pressable>
        </Animated.View>
      </Swipeable>
    </Animated.View>
  );
});

/** A row inside a reorderable list: a long press picks it up, with a bump of haptics. */
export function DragRow(props: Omit<Parameters<typeof TaskRow>[0], "onLongPress">) {
  const drag = useReorderableDrag();
  return <TaskRow {...props} onLongPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); drag(); }} />;
}

const tickOver = () => { void Haptics.selectionAsync(); };

/** A run of tasks as rows. `reorderable`: a long press picks a row up and a drop writes `order` (core/task-order.ts) for the
 *  tasks that moved, a tick of haptics for every place passed. It lives inside a `ScrollViewContainer`. */
export function TaskList({ tasks, today, ticking, actions, reorderable, ground }: {
  tasks: Task[]; today: string; ticking: Record<string, true>; actions: RowActions; reorderable?: boolean;
  ground?: string;
}) {
  // A drag begins only after the long press, so a refresh pull or a swipe never picks a row up
  const pan = useMemo(() => Gesture.Pan().activateAfterLongPress(320), []);
  if (!reorderable) {
    return (
      <View>
        {tasks.map((t) => <TaskRow key={t.id} task={t} today={today} ticking={!!ticking[t.id]} ground={ground} {...actions} />)}
      </View>
    );
  }
  return (
    <NestedReorderableList data={tasks} keyExtractor={(t) => t.id} panGesture={pan} initialNumToRender={Math.max(10, tasks.length)}
      onIndexChange={() => { "worklet"; scheduleOnRN(tickOver); }}
      onReorder={({ from, to }) => {
        for (const w of reorder(tasks, from, to)) useTodo.getState().update(w.id, { order: w.order });
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }}
      renderItem={({ item }) => <DragRow task={item} today={today} ticking={!!ticking[item.id]} {...actions} />} />
  );
}
