// The message pill: a field (multiline, growing to five lines, unless `multiline` is off) and one round button that is
// the microphone while the field is empty, send once there is text, and stop while a reply streams. While recording the
// field gives way to a row: cancel, the level meter, confirm. The composer records nothing: the app's dictation does,
// and hands back `level`. Ask's message box and the assistant box (Home, a note's screen) are both this one.
import * as Haptics from "expo-haptics";
import { ArrowUp, Check, Mic, Square, X } from "lucide-react-native";
import { useState, type ReactNode, type Ref } from "react";
import { TextInput, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming, ZoomIn } from "react-native-reanimated";
import { IconButton, LevelMeter, useButtonInk } from "../ds";
import { useTheme } from "../use-theme";

export type ComposerStatus = "ready" | "submitted" | "streaming" | "recording";

const LINE = 22, MAX_ROWS = 5;

/** The round button: it sinks under the finger and springs back, and a change of what it does (dictate, send, stop) swaps
 *  the icon with a small pop — the icon it mounts with just sits. */
function RoundButton({ mode, label, variant, disabled, onPress, hint, children }: {
  mode: "stop" | "voice" | "send"; label: string; variant: "tonal" | "filled"; disabled: boolean; onPress: () => void; hint?: string; children: ReactNode;
}) {
  const scale = useSharedValue(1);
  const [first] = useState(mode);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <Animated.View style={style}>
      <IconButton label={label} variant={variant} disabled={disabled} onPress={onPress} accessibilityHint={hint}
        onPressIn={() => { scale.set(withTiming(0.86, { duration: 80 })); }} onPressOut={() => { scale.set(withSpring(1, { damping: 12, stiffness: 320 })); }}>
        <Animated.View key={mode} entering={mode === first ? undefined : ZoomIn.duration(150)}>{children}</Animated.View>
      </IconButton>
    </Animated.View>
  );
}

export function Composer({ value, onChangeText, onSubmit, onStop, onVoice, onRecordConfirm, onRecordCancel, level = 0, status, disabled, placeholder,
  multiline = true, inputRef, sendLabel = "Send", sendHint }: {
  value: string; onChangeText: (t: string) => void; onSubmit: (text: string) => void; onStop?: () => void;
  onVoice?: () => void; onRecordConfirm?: () => void; onRecordCancel?: () => void; level?: number;
  status: ComposerStatus; disabled?: boolean; placeholder?: string;
  /** False: one line, and the keyboard's action key submits. */
  multiline?: boolean;
  inputRef?: Ref<TextInput>;
  sendLabel?: string; sendHint?: string;
}) {
  const { C } = useTheme();
  const filled = useButtonInk("filled"), tonal = useButtonInk("tonal");
  const busy = onStop != null && (status === "submitted" || status === "streaming");
  const text = value.trim();
  const mode = busy ? "stop" : text ? "send" : onVoice ? "voice" : "send";
  const act = () => {
    if (mode === "stop") onStop?.();
    else if (mode === "voice") onVoice?.();
    else if (text) onSubmit(value);
  };
  const press = () => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); act(); };
  const Icon = mode === "stop" ? Square : mode === "voice" ? Mic : ArrowUp;
  const dead = mode === "stop" ? false : disabled || (mode === "send" && !text);
  const ink = mode === "voice" ? tonal : filled;

  if (status === "recording")
    return (
      <View className="min-h-14 flex-row items-center gap-3 rounded-full border border-line bg-card p-1.5">
        <IconButton label="Cancel recording" icon={X} variant="tonal" onPress={onRecordCancel} />
        <LevelMeter level={level} className="flex-1" />
        <IconButton label="Use recording" icon={Check} variant="filled" onPress={onRecordConfirm} />
      </View>
    );
  return (
    <View className="min-h-14 flex-row items-end gap-2 rounded-[28px] border border-line bg-card py-1 pl-5 pr-1.5">
      <TextInput ref={inputRef} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={C.faint} selectionColor={C.brand} cursorColor={C.brand}
        multiline={multiline} editable={!disabled} accessibilityLabel={placeholder}
        {...(multiline ? {} : { returnKeyType: "done" as const, submitBehavior: "submit" as const, onSubmitEditing: () => { if (text) onSubmit(value); } })}
        className="flex-1 py-3 font-sans text-[16px] text-fg" style={{ maxHeight: LINE * MAX_ROWS + 24, textAlignVertical: multiline ? "top" : "center" }} />
      <RoundButton mode={mode} label={mode === "stop" ? "Stop" : mode === "voice" ? "Dictate" : sendLabel} variant={mode === "voice" ? "tonal" : "filled"} disabled={dead}
        onPress={press} hint={mode === "send" ? sendHint : undefined}>
        <Icon size={20} color={ink} fill={mode === "stop" ? ink : "none"} />
      </RoundButton>
    </View>
  );
}
