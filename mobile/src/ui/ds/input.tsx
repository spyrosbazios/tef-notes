// Text fields: a filled, rounded-xl box that takes the brand's ring while focused, an optional label over it and a
// hint or error under.
import { useState, type ReactNode, type Ref } from "react";
import { TextInput, View, type TextInputProps } from "react-native";
import { useTheme } from "../use-theme";
import { cn } from "./cn";
import { T } from "./text";

export type InputProps = TextInputProps & {
  label?: string;
  hint?: string;
  error?: string;
  /** Before the text, inside the box (a search glass). */
  start?: ReactNode;
  /** After the text, inside the box (a clear button). */
  end?: ReactNode;
  className?: string;
  containerClassName?: string;
  ref?: Ref<TextInput>;
};

function Field({ label, hint, error, start, end, className, containerClassName, multiline, onFocus, onBlur, ref, ...p }: InputProps) {
  const { C } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View className={cn("gap-1.5", containerClassName)}>
      {label ? <T variant="label" className="px-1">{label}</T> : null}
      <View className={cn("flex-row items-center rounded-xl border bg-muted", multiline ? "items-start" : "min-h-12",
        error ? "border-down" : focused ? "border-brand" : "border-transparent")}>
        {start ? <View className="pl-3.5">{start}</View> : null}
        <TextInput {...p} ref={ref} multiline={multiline} placeholderTextColor={C.faint} selectionColor={C.brand} cursorColor={C.brand}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }} onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          className={cn("flex-1 px-3.5 font-sans text-[16px] text-fg", multiline ? "min-h-24 py-3" : "py-2.5", className)}
          style={multiline ? { textAlignVertical: "top" } : undefined} />
        {end ? <View className="pr-2">{end}</View> : null}
      </View>
      {error ? <T tone="down" size={12} className="px-1">{error}</T> : hint ? <T variant="caption" className="px-1">{hint}</T> : null}
    </View>
  );
}

export function Input(p: InputProps) {
  return <Field {...p} />;
}

/** A field for paragraphs: grows from four lines, top-aligned. */
export function Textarea(p: Omit<InputProps, "multiline">) {
  return <Field {...p} multiline />;
}
