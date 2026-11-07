// A message inside a screen that wants attention: a tinted panel with an icon, a title, words and actions under.
// `warning` for a decision waiting, `destructive` for something that failed, `info` for a note in passing.
import { CircleAlert, Info, TriangleAlert, type LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useTheme } from "../use-theme";
import { cn } from "./cn";
import { T } from "./text";

type Kind = "warning" | "destructive" | "info";
const WASH: Record<Kind, string> = { warning: "bg-warn-soft border-warn-subtle", destructive: "bg-down-soft border-down-subtle", info: "bg-accent border-transparent" };
const ICON: Record<Kind, LucideIcon> = { warning: TriangleAlert, destructive: CircleAlert, info: Info };

export function Banner({ variant = "info", title, description, children, className }: { variant?: Kind; title: string; description?: string; children?: ReactNode; className?: string }) {
  const { C } = useTheme();
  const Icon = ICON[variant], ink = variant === "warning" ? C.warn : variant === "destructive" ? C.down : C.brand;
  return (
    <View accessibilityRole="alert" className={cn("flex-row gap-3 rounded-2xl border p-4", WASH[variant], className)}>
      <Icon size={18} color={ink} style={{ marginTop: 1 }} />
      <View className="flex-1 gap-2">
        <T font="semi" size={15} className="leading-5">{title}</T>
        {description ? <T tone="dim" size={14} className="leading-5">{description}</T> : null}
        {children}
      </View>
    </View>
  );
}
