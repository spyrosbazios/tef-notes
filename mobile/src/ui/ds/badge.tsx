// Small labels. A Badge is a status word in a tinted pill (not pressable); a Chip is a pressable, selectable pill
// (a filter, a choice), 36dp tall with a 48dp target.
import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "../use-theme";
import { cn } from "./cn";
import { T, type Tone } from "./text";

const WASH: Partial<Record<Tone, string>> = { up: "bg-up-subtle", down: "bg-down-subtle", warn: "bg-warn-subtle", brand: "bg-accent" };

export function Badge({ label, tone = "dim", className }: { label: string; tone?: Tone; className?: string }) {
  return (
    <View className={cn("h-5 justify-center self-center rounded-full px-2", WASH[tone] ?? "bg-muted", className)}>
      <T tone={tone} font="semi" size={11}>{label}</T>
    </View>
  );
}

export type ChipProps = {
  label?: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: LucideIcon;
  /** A colour of its own for the icon (a tag's dot colour). */
  iconColor?: string;
  size?: "sm" | "md";
  accessibilityLabel?: string;
  className?: string;
  children?: ReactNode;
};

export function Chip({ label, selected, onPress, icon: Icon, iconColor, size = "md", accessibilityLabel, className, children }: ChipProps) {
  const { C } = useTheme();
  return (
    <Pressable onPress={onPress ? () => { void Haptics.selectionAsync(); onPress(); } : undefined} disabled={!onPress}
      accessibilityRole="button" accessibilityState={{ selected: !!selected }} accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={size === "sm" ? 8 : 6}
      className={cn("flex-row items-center gap-1.5 rounded-full border active:opacity-70", size === "sm" ? "h-8 px-3" : "h-9 px-3.5",
        selected ? "border-transparent bg-accent" : "border-line bg-transparent", className)}>
      {Icon && <Icon size={size === "sm" ? 14 : 16} color={iconColor ?? (selected ? C.brand : C.dim)} />}
      {label != null && <T tone={selected ? "brand" : "fg"} font="medium" size={size === "sm" ? 13 : 14} numberOfLines={1}>{label}</T>}
      {children}
    </Pressable>
  );
}
