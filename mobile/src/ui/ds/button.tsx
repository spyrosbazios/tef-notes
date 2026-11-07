// Buttons. Pills by default, 48dp tall at `md` (Android's touch target). A text child is set in the variant's colour;
// `icon` takes a lucide component and colours it the same, so callers never pick a colour for a button's content.
import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, View, type PressableProps } from "react-native";
import { useTheme } from "../use-theme";
import { cn } from "./cn";
import { T, type Tone } from "./text";

export type ButtonVariant = "filled" | "tonal" | "outline" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

const ROOT: Record<ButtonVariant, string> = {
  filled: "bg-brand",
  tonal: "bg-raised",
  outline: "border border-line bg-transparent",
  ghost: "bg-transparent active:bg-muted",
  destructive: "bg-down",
};
const TONE: Record<ButtonVariant, Tone> = { filled: "bg", tonal: "fg", outline: "fg", ghost: "fg", destructive: "bg" };
const SIZE: Record<ButtonSize, { root: string; text: number; icon: number }> = {
  sm: { root: "min-h-9 px-3.5 gap-1.5", text: 14, icon: 16 },
  md: { root: "min-h-12 px-5 gap-2", text: 15, icon: 18 },
  lg: { root: "min-h-14 px-6 gap-2", text: 17, icon: 20 },
};

/** The colour a variant's content is drawn in, for an icon a caller passes as a child. */
export function useButtonInk(variant: ButtonVariant = "filled") {
  const { C } = useTheme();
  return C[TONE[variant]];
}

export type ButtonProps = Omit<PressableProps, "children"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
  className?: string;
  children?: ReactNode;
};

export function Button({ variant = "filled", size = "md", icon: Icon, loading, disabled, className, children, ...p }: ButtonProps) {
  const ink = useButtonInk(variant), s = SIZE[size];
  return (
    <Pressable accessibilityRole="button" {...p} disabled={disabled || loading} accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      className={cn("flex-row items-center justify-center rounded-full active:opacity-80", ROOT[variant], s.root, disabled && "opacity-45", className)}>
      {loading ? <ActivityIndicator size="small" color={ink} /> : Icon ? <Icon size={s.icon} color={ink} strokeWidth={2.2} /> : null}
      {typeof children === "string" ? <T tone={TONE[variant]} font="semi" size={s.text} numberOfLines={1}>{children}</T> : children}
    </Pressable>
  );
}

export type IconButtonProps = Omit<PressableProps, "children"> & {
  /** What a screen reader says: an icon has no words of its own. */
  label: string;
  icon?: LucideIcon;
  /** The icon's colour, when not the variant's (a brand or a down tone). */
  color?: string;
  variant?: Exclude<ButtonVariant, "outline">;
  /** The icon's size; the target stays 48dp unless `compact` (36dp, for dense bars). */
  size?: number;
  compact?: boolean;
  className?: string;
  children?: ReactNode;
};

/** A round icon-only button. `icon` (coloured for you) or a child icon. */
export function IconButton({ label, icon: Icon, color, variant = "ghost", size = 22, compact, disabled, className, children, ...p }: IconButtonProps) {
  const ink = useButtonInk(variant);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={compact ? 6 : 0} {...p} disabled={disabled}
      className={cn("items-center justify-center rounded-full active:opacity-70", compact ? "h-9 w-9" : "h-12 w-12", ROOT[variant], disabled && "opacity-40", className)}>
      {Icon ? <Icon size={size} color={color ?? ink} strokeWidth={2} /> : <View pointerEvents="none">{children}</View>}
    </Pressable>
  );
}
