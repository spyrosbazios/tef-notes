// Text. A `variant` sets the role (size, face, tone); `tone`, `font` and `size` override one part of it. They are
// props rather than free classNames so two colour or face classes never meet on one element.
import { Text, type TextProps } from "react-native";
import { cn } from "./cn";

export type Tone = "fg" | "dim" | "faint" | "up" | "down" | "brand" | "warn" | "bg";
export type Font = "sans" | "medium" | "semi" | "heavy" | "num" | "num-bold" | "display" | "mono";   // mono: addresses and code only
export type Variant = "display" | "title" | "heading" | "body" | "label" | "caption";

const TONE: Record<Tone, string> = {
  fg: "text-fg", dim: "text-dim", faint: "text-faint", up: "text-up", down: "text-down", brand: "text-brand", warn: "text-warn", bg: "text-bg",
};
const FONT: Record<Font, string> = {
  sans: "font-sans", medium: "font-medium", semi: "font-semi", heavy: "font-heavy", num: "font-num", "num-bold": "font-num-bold", display: "font-display", mono: "font-mono",
};
/** A screen's large title; a sheet's or section's title; a row's heading; reading text; a control's label; small print. */
const VARIANT: Record<Variant, { size: number; font: Font; tone: Tone; spacing?: number }> = {
  display: { size: 30, font: "display", tone: "fg", spacing: -0.6 },
  title: { size: 20, font: "heavy", tone: "fg", spacing: -0.2 },
  heading: { size: 16, font: "semi", tone: "fg" },
  body: { size: 15, font: "sans", tone: "fg" },
  label: { size: 13, font: "semi", tone: "dim" },
  caption: { size: 12, font: "sans", tone: "dim" },
};

export type TProps = TextProps & { variant?: Variant; tone?: Tone; font?: Font; size?: number; className?: string };

export function T({ variant, tone, font, size, className, style, ...p }: TProps) {
  const v = variant ? VARIANT[variant] : undefined;
  return (
    <Text {...p} className={cn(TONE[tone ?? v?.tone ?? "fg"], FONT[font ?? v?.font ?? "sans"], className)}
      style={[{ fontSize: size ?? v?.size ?? 14, letterSpacing: v?.spacing, fontVariant: ["tabular-nums"] }, style]} />
  );
}
