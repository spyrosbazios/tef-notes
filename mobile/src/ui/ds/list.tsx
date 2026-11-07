// Grouped settings-style rows: a ListSection is a titled rounded card, its ListRows separated by inset hairlines.
// A row is 56dp at least: an optional leading icon in a tinted square, a title and a subtitle, and a trailing slot
// (a value, a Switch, a check), with a chevron when it opens something.
import type { LucideIcon } from "lucide-react-native";
import { ChevronRight } from "lucide-react-native";
import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { cap } from "@/core/agent";
import { useTheme } from "../use-theme";
import { cn } from "./cn";
import { T } from "./text";

export function ListSection({ title, footer, className, children }: { title?: string; footer?: string; className?: string; children: ReactNode }) {
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View className={cn("gap-2", className)}>
      {title ? <T variant="label" size={12} className="px-4">{cap(title)}</T> : null}
      <View className="overflow-hidden rounded-2xl bg-card">
        {rows.map((r, i) => (
          <Fragment key={r.key ?? i}>
            {i > 0 && <View className="ml-4 h-px bg-line" />}
            {r}
          </Fragment>
        ))}
      </View>
      {footer ? <T variant="caption" className="px-4 leading-[18px]">{footer}</T> : null}
    </View>
  );
}

export type ListRowProps = {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  /** Anything else at the row's start, in place of `icon` (a swatch, an avatar). */
  leading?: ReactNode;
  /** The leading icon's colour (default the brand). */
  iconColor?: string;
  /** A value, a Switch, a check: what sits at the row's end. */
  trailing?: ReactNode;
  /** Shows a chevron: the row opens something. */
  chevron?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  /** A choice among rows (a radio): announced as checked or not. */
  selected?: boolean;
  /** Anything under the title row (a field, a hint). */
  children?: ReactNode;
  className?: string;
};

export function ListRow({ title, subtitle, icon: Icon, leading, iconColor, trailing, chevron, onPress, disabled, destructive, selected, children, className }: ListRowProps) {
  const { C } = useTheme();
  const body = (
    <>
      <View className="min-h-14 flex-row items-center gap-3.5 py-2.5">
        {leading}
        {Icon && (
          <View className="h-9 w-9 items-center justify-center rounded-xl bg-accent">
            <Icon size={19} color={destructive ? C.down : iconColor ?? C.brand} strokeWidth={2} />
          </View>
        )}
        <View className="flex-1 gap-0.5">
          <T size={15} font="medium" tone={destructive ? "down" : "fg"}>{title}</T>
          {subtitle ? <T variant="caption" size={13} className="leading-[18px]">{subtitle}</T> : null}
        </View>
        {trailing}
        {chevron && <ChevronRight size={18} color={C.faint} />}
      </View>
      {children}
    </>
  );
  return onPress ? (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole={selected == null ? "button" : "radio"} accessibilityLabel={title}
      accessibilityState={selected == null ? undefined : { checked: selected }}
      className={cn("px-4 active:bg-muted", disabled && "opacity-45", className)}>{body}</Pressable>
  ) : (
    <View className={cn("px-4", className)}>{body}</View>
  );
}
