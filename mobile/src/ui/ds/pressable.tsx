// A pressable surface that dims and settles a little under the finger: rows, tiles, list items. Buttons have their own.
import { Pressable, type PressableProps } from "react-native";
import { cn } from "./cn";

export function Touchable({ className, ...p }: PressableProps & { className?: string }) {
  return <Pressable {...p} className={cn("active:opacity-70 active:scale-[0.98]", className)} />;
}
