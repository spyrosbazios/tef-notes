// One tool call as a row: a status glyph (waiting, running, done, failed), its name, and, when there is something to say
// (what it looked for, why it failed), a fold that opens under it. `ToolLine` is a line of that content. A failed call
// opens itself: the caller remounts it with a new key when it fails.
import * as Haptics from "expo-haptics";
import { CircleAlert, CircleCheck, Circle, Search } from "lucide-react-native";
import { Children, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition, ZoomIn } from "react-native-reanimated";
import { T } from "../ds";
import { useTheme } from "../use-theme";
import { Chevron, FOLD } from "./chevron";
import { Pulse } from "./pulse";

export type ToolStatus = "pending" | "running" | "complete" | "error";


function Glyph({ status }: { status: ToolStatus }) {
  const { C } = useTheme();
  if (status === "error") return <CircleAlert size={16} color={C.down} />;
  if (status === "complete") return <CircleCheck size={16} color={C.up} />;
  if (status === "running") return <Pulse><Search size={16} color={C.dim} /></Pulse>;
  return <Circle size={16} color={C.faint} />;
}

/** The glyph; a change of state (running, then done) swaps it with a small pop. The glyph a row mounts with just sits. */
function StatusIcon({ status }: { status: ToolStatus }) {
  const [first] = useState(status);
  return <Animated.View key={status} entering={status === first ? undefined : ZoomIn.duration(160)}><Glyph status={status} /></Animated.View>;
}

export function ToolRow({ title, status, defaultOpen = false, children }: { title: string; status: ToolStatus; defaultOpen?: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const has = Children.toArray(children).length > 0;
  return (
    <Animated.View layout={LinearTransition.duration(FOLD)}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} disabled={!has}
        onPress={() => { Haptics.selectionAsync(); setOpen(!open); }} className="flex-row items-center gap-2 py-0.5 active:opacity-70">
        <StatusIcon status={status} />
        <View className="flex-1 flex-row"><Pulse active={status === "running"}><T tone={status === "error" ? "down" : "dim"} size={14} numberOfLines={1}>{title}</T></Pulse></View>
        {has ? <Chevron open={open} /> : null}
      </Pressable>
      {open && has ? <Animated.View entering={FadeIn.duration(FOLD)} exiting={FadeOut.duration(FOLD / 2)} className="ms-2 mt-1 gap-1 border-s border-line ps-4">{children}</Animated.View> : null}
    </Animated.View>
  );
}

export function ToolLine({ children }: { children: string }) {
  return <T tone="dim" size={13}>{children}</T>;
}
