// The assistant's question (`ask_choice`, core/assistant.ts): a few buttons in the chat, answered by a tap, which resumes the turn.
// Single choice: a tap answers. Multi: tap to toggle, then Send. Only the newest turn, once its reply has stopped, can still be
// answered; a question passed over for a new message is closed as an error by the server, so it is drawn as unanswered.
// Answered, it folds to the line of what was chosen.
import { Check } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import * as Haptics from "expo-haptics";
import type { ChoiceOption, UiToolInput } from "@/core/assistant";
import { Button, cn, PressScale, T } from "../ds";
import { useTheme } from "../use-theme";

type Ask = UiToolInput["ask_choice"];

function Option({ o, picked, multi, onPress }: { o: ChoiceOption; picked: boolean; multi: boolean; onPress: () => void }) {
  const { C } = useTheme();
  return (
    <PressScale onPress={() => { void Haptics.selectionAsync(); onPress(); }} accessibilityRole={multi ? "checkbox" : "button"}
      accessibilityState={multi ? { checked: picked } : undefined} accessibilityLabel={o.hint ? `${o.label}. ${o.hint}` : o.label} scaleTo={0.98}
      className={cn("flex-row items-center gap-3 rounded-xl border px-3.5 py-3", picked ? "border-brand-line bg-accent" : "border-line bg-card")}>
      <View className="flex-1 gap-0.5">
        <T font="medium" size={15} tone={picked ? "brand" : "fg"}>{o.label}</T>
        {o.hint ? <T tone="dim" size={13}>{o.hint}</T> : null}
      </View>
      {multi ? <Check size={18} color={picked ? C.brand : C.faint} strokeWidth={picked ? 3 : 2} /> : null}
    </PressScale>
  );
}

/** A question waiting for the owner: `answer` is called once, with the ids chosen. */
function Pending({ ask, answer }: { ask: Ask; answer: (ids: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const multi = !!ask.multi;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <View className="gap-2.5 rounded-2xl border border-line bg-raised p-3.5">
      <T font="semi" size={15} className="leading-5">{ask.question}</T>
      <View className="gap-2">
        {ask.options.map((o) => (
          <Option key={o.id} o={o} multi={multi} picked={picked.includes(o.id)} onPress={() => (multi ? toggle(o.id) : answer([o.id]))} />
        ))}
      </View>
      {multi ? (
        <Button size="sm" className="self-end" disabled={!picked.length} onPress={() => answer(ask.options.filter((o) => picked.includes(o.id)).map((o) => o.id))}>
          Send
        </Button>
      ) : null}
    </View>
  );
}

/** The question as the chat shows it. `chosen`: the ids it was answered with, once it was. `open`: it can still be answered
 *  (the newest turn, its reply stopped). */
export function Choice({ ask, chosen, open, answer }: { ask: Ask; chosen: string[] | null; open: boolean; answer: (ids: string[]) => void }) {
  const { C } = useTheme();
  if (!chosen && open) return <Pending ask={ask} answer={answer} />;
  const labels = chosen ? ask.options.filter((o) => chosen.includes(o.id)).map((o) => o.label) : [];
  return (
    <View className="gap-1 rounded-2xl border border-line px-3.5 py-3">
      <T tone="dim" size={13}>{ask.question}</T>
      {chosen ? (
        <View className="flex-row items-center gap-1.5">
          <Check size={14} color={C.brand} strokeWidth={3} />
          <T font="medium" size={14} className="shrink">{labels.join(", ") || "Chosen"}</T>
        </View>
      ) : (
        <T tone="faint" size={13}>Not answered</T>
      )}
    </View>
  );
}
