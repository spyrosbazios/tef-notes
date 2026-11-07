// A surface: rounded-3xl, in a tone: `card` (the default), `raised` (a section on a card-coloured sheet) or `brand` (a
// section washed in the brand),  no shadow (invisible on the dark grounds, muddy on paper).
// `title` heads it in small caps-style label text, `right` beside it.
import type { ReactNode } from "react";
import { View, type ViewProps } from "react-native";
import { cap } from "@/core/agent";
import { cn } from "./cn";
import { T } from "./text";

const TONE = { card: "bg-card border-line", raised: "bg-raised border-line", brand: "bg-brand-soft border-brand-line" } as const;

export type CardProps = ViewProps & { tone?: keyof typeof TONE; title?: string; right?: ReactNode; pad?: boolean; className?: string; children?: ReactNode };

export function Card({ tone = "card", title, right, pad = true, className, children, ...p }: CardProps) {
  return (
    <View {...p} className={cn("overflow-hidden rounded-3xl border", TONE[tone], className)}>
      {title != null && (
        <View className="flex-row items-center justify-between px-4 pt-3.5 pb-1">
          <T variant="label" size={12}>{cap(title)}</T>
          {right}
        </View>
      )}
      <View className={pad ? "px-4 pb-4 pt-1.5" : ""}>{children}</View>
    </View>
  );
}
