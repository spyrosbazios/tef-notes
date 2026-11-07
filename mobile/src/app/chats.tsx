// Past Ask chats, newest first, as the notes server keeps them (the laptop's too). Tap one to carry on where it stopped.
import * as Haptics from "expo-haptics";
import { MessageSquare, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChatRec } from "@/core/pocketbase";
import { mdhm } from "@/core/time";
import { useChats } from "@/store/chats";
import { AlertDialog, EmptyState, IconButton, ListRow, ListSection, ScreenHeader, T } from "@/ui/ds";
import { goBack } from "@/ui/note";
import { useTheme } from "@/ui/use-theme";

export default function Chats() {
  const { C } = useTheme();
  const insets = useSafeAreaInsets();
  const { chats, current, open, remove, refresh } = useChats();
  const [removing, setRemoving] = useState<ChatRec | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const failed = (e: unknown) => setErr(e instanceof Error ? e.message : String(e));
  useEffect(() => { refresh().then(() => setErr(null), failed); }, [refresh]);
  const pick = (id: string) => { open(id); goBack("/ask"); };
  const askRemove = (c: ChatRec) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setRemoving(c); };

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title="Chats" compact back={() => goBack("/ask")} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}>
        {err ? <T tone="warn" size={13} className="pb-3 pt-1">{`Couldn't list the chats: ${err}`}</T> : null}
        {!chats.length && !err ? (
          <EmptyState icon={MessageSquare} title="No saved chats yet" hint="A chat lands here once its first message goes." />
        ) : null}
        {chats.length ? (
          <ListSection>
            {chats.map((c) => (
              <ListRow key={c.id} title={c.title || "Untitled"} subtitle={mdhm(Date.parse(c.updated.replace(" ", "T")) / 1000)} icon={MessageSquare}
                iconColor={c.id === current.id ? C.brand : C.dim} onPress={() => pick(c.id)}
                trailing={<IconButton icon={Trash2} size={20} compact label={`Delete ${c.title || "Untitled"}`} color={C.dim} onPress={() => askRemove(c)} />} />
            ))}
          </ListSection>
        ) : null}
      </ScrollView>

      <AlertDialog open={!!removing} onOpenChange={(o) => { if (!o) setRemoving(null); }} title={removing?.title || "Untitled"}
        description="Delete this chat? It goes from the server, so from the laptop too." action="Delete" destructive
        onAction={() => { if (removing) remove(removing.id).catch(failed); setRemoving(null); }} />
    </View>
  );
}
