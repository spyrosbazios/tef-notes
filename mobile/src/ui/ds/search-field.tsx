// A pill search field: a glass, the text, a clear button. `tokens` are filters already picked (tags), shown as chips
// before the text; backspace in an empty field takes the last off. `onDebouncedChange` follows the typing at `debounce` ms.
import { Search, X } from "lucide-react-native";
import { useEffect, useRef } from "react";
import { Pressable, TextInput, View, type TextInputProps } from "react-native";
import { useTheme } from "../use-theme";
import { cn } from "./cn";
import { T } from "./text";

export type SearchFieldProps = Omit<TextInputProps, "onChangeText" | "value"> & {
  value: string;
  onChangeText: (v: string) => void;
  debounce?: number;
  onDebouncedChange?: (v: string) => void;
  tokens?: string[];
  onRemoveToken?: (t: string) => void;
  containerClassName?: string;
};

export function SearchField({ value, onChangeText, debounce = 0, onDebouncedChange, tokens = [], onRemoveToken, containerClassName, onKeyPress, ...p }: SearchFieldProps) {
  const { C } = useTheme();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const change = (v: string) => {
    onChangeText(v);
    if (!onDebouncedChange) return;
    clearTimeout(timer.current);
    if (debounce) timer.current = setTimeout(() => onDebouncedChange(v), debounce); else onDebouncedChange(v);
  };
  return (
    <View className={containerClassName}>
      <View className="min-h-12 flex-row flex-wrap items-center gap-1.5 rounded-full bg-muted pl-4 pr-1">
        <Search size={18} color={C.dim} />
        {tokens.map((t) => (
          <Pressable key={t} onPress={() => onRemoveToken?.(t)} accessibilityRole="button" accessibilityLabel={`Remove ${t}`}
            className="h-7 flex-row items-center gap-1 rounded-full bg-accent pl-2.5 pr-1.5">
            <T tone="brand" font="medium" size={13}>{t}</T>
            <X size={13} color={C.brand} />
          </Pressable>
        ))}
        <TextInput {...p} value={value} onChangeText={change} placeholderTextColor={C.faint} selectionColor={C.brand} cursorColor={C.brand}
          returnKeyType="search" className={cn("min-w-24 flex-1 py-2.5 font-sans text-[16px] text-fg")}
          onKeyPress={(e) => { if (e.nativeEvent.key === "Backspace" && !value && tokens.length) onRemoveToken?.(tokens[tokens.length - 1]); onKeyPress?.(e); }} />
        {value ? (
          <Pressable onPress={() => change("")} accessibilityRole="button" accessibilityLabel="Clear search" className="h-10 w-10 items-center justify-center rounded-full active:bg-muted">
            <X size={18} color={C.dim} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
