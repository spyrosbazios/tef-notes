// A menu that drops from its trigger, on @rn-primitives/dropdown-menu: Trigger wraps the button, Content holds Items
// (an icon, a label, `destructive` in red) and Separators. Closes on a pick or a tap outside.
import * as Primitive from "@rn-primitives/dropdown-menu";
import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useTheme } from "../use-theme";
import { cn } from "./cn";
import { T } from "./text";

function Trigger({ children }: { children: ReactNode }) {
  return <Primitive.Trigger asChild>{children}</Primitive.Trigger>;
}

function Content({ align = "end", className, children }: { align?: "start" | "center" | "end"; className?: string; children: ReactNode }) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay style={StyleSheet.absoluteFill}>
        <Primitive.Content align={align} sideOffset={4} insets={{ left: 12, right: 12 }}
          className={cn("min-w-52 overflow-hidden rounded-2xl border border-line bg-raised py-1.5", className)}>
          <Animated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(90)}>{children}</Animated.View>
        </Primitive.Content>
      </Primitive.Overlay>
    </Primitive.Portal>
  );
}

function Item({ label, icon: Icon, onPress, destructive, disabled }: { label: string; icon?: LucideIcon; onPress: () => void; destructive?: boolean; disabled?: boolean }) {
  const { C } = useTheme();
  return (
    <Primitive.Item onPress={onPress} disabled={disabled} textValue={label}
      className={cn("min-h-12 flex-row items-center gap-3 px-4 active:bg-muted", disabled && "opacity-45")}>
      {Icon && <Icon size={18} color={destructive ? C.down : C.dim} />}
      <T size={15} tone={destructive ? "down" : "fg"}>{label}</T>
    </Primitive.Item>
  );
}

function Separator() {
  return <View className="my-1 h-px bg-line" />;
}

export const DropdownMenu = Object.assign(
  ({ children }: { children: ReactNode }) => <Primitive.Root>{children}</Primitive.Root>,
  { Trigger, Content, Item, Separator },
);
