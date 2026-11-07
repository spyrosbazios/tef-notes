// What a list says when it has nothing: an icon in a soft disc, a line in words, an optional hint and action.
// `inline` is the quiet one-line form for a section inside a screen.
import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useTheme } from "../use-theme";
import { cn } from "./cn";
import { T } from "./text";

export type EmptyStateProps = { icon?: LucideIcon; title: string; hint?: string; action?: ReactNode; inline?: boolean; className?: string };

export function EmptyState({ icon: Icon, title, hint, action, inline, className }: EmptyStateProps) {
  const { C } = useTheme();
  if (inline) return <T tone="faint" size={13} className={cn("py-2", className)}>{title}</T>;
  return (
    <View className={cn("items-center gap-3 px-8 py-12", className)}>
      {Icon && (
        <View className="h-16 w-16 items-center justify-center rounded-full bg-muted">
          <Icon size={28} color={C.dim} strokeWidth={1.8} />
        </View>
      )}
      <T variant="heading" className="text-center">{title}</T>
      {hint ? <T variant="caption" size={14} className="text-center leading-5">{hint}</T> : null}
      {action ? <View className="mt-2">{action}</View> : null}
    </View>
  );
}
