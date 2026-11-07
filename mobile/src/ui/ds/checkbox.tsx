// A tick. `round` is a task's (Things-style circle, a haptic on ticking); square is a list box's. `color` tints the
// ring and fill (a note's colour); otherwise the brand.
import * as Primitive from "@rn-primitives/checkbox";
import * as Haptics from "expo-haptics";
import { Check } from "lucide-react-native";
import { useTheme } from "../use-theme";
import { cn } from "./cn";

export type CheckboxProps = {
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
  round?: boolean;
  color?: string;
  /** The box's side in dp; the touch target stays 48dp around it. */
  size?: number;
  disabled?: boolean;
  accessibilityLabel?: string;
  className?: string;
};

export function Checkbox({ checked, onCheckedChange, round, color, size = 22, disabled, accessibilityLabel, className }: CheckboxProps) {
  const { C } = useTheme();
  const ink = color ?? C.brand;
  const change = (on: boolean) => {
    if (on) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onCheckedChange(on);
  };
  const pad = Math.max(0, (48 - size) / 2);
  return (
    <Primitive.Root checked={checked} onCheckedChange={change} disabled={disabled} accessibilityLabel={accessibilityLabel}
      hitSlop={pad} className={cn("items-center justify-center border-2", round ? "rounded-full" : "rounded-md", disabled && "opacity-45", className)}
      style={{ width: size, height: size, borderColor: checked ? ink : C.faint, backgroundColor: checked ? ink : "transparent" }}>
      <Primitive.Indicator className="items-center justify-center">
        <Check size={size * 0.62} color={C.bg} strokeWidth={3.2} />
      </Primitive.Indicator>
    </Primitive.Root>
  );
}
