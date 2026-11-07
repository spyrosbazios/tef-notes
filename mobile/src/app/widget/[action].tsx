// Where a widget's quick actions land (src/widget/widgets.tsx: tefnotes://widget/<action>): `ask` opens a fresh chat on
// the Ask tab with its field focused (an empty draft, as "Ask about this note" hands one over); `note` makes a note and
// opens it in the editor, as Home's New note button does, with Home under it for Back. This screen only passes through.
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef } from "react";
import { View } from "react-native";
import { replying } from "@/agent/background";
import { useChats } from "@/store/chats";
import { newNote } from "@/ui/note";

export default function WidgetAction() {
  const { action } = useLocalSearchParams<{ action: string }>();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (action === "note") {
      router.replace("/home");
      newNote();
      return;
    }
    if (action === "ask") useChats.getState().startDraft("", replying() != null);
    router.replace(action === "ask" ? "/ask" : "/home");
  }, [action]);
  return <View className="flex-1 bg-bg" />;
}
