// How hard the agent works (@/core/agent EFFORT) and which model it runs on (the server's provider's models as the server lists them,
// GET /agent/models), in a sheet. Both picks are this phone's (src/store/prefs.ts) and go with every message. Opened from Ask's model chip and from Settings.
import * as Haptics from "expo-haptics";
import { Check } from "lucide-react-native";
import { View } from "react-native";
import { cap, EFFORT, EFFORTS, effortOf } from "@/core/agent";
import { useModel } from "@/store/agent";
import { usePrefs } from "@/store/prefs";
import { ListRow, Sheet, T } from "./ds";
import { useTheme } from "./use-theme";

export function ModelSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { C } = useTheme();
  const { model, models: q } = useModel();
  const effort = effortOf(usePrefs((s) => s.agentEffort));
  const offered = q.data?.available ? q.data : undefined;
  // a saved id the list no longer has stays shown, picked
  const ids = !offered ? [] : model && !offered.models.includes(model) ? [model, ...offered.models] : offered.models;
  const pick = (id: string) => {
    Haptics.selectionAsync();
    usePrefs.getState().set({ agentModelId: id });
    onOpenChange(false);
  };
  const note = q.isPending ? "Asking the server…" : q.isError ? `Couldn't reach the agent (${(q.error as Error).message}).`
    : !offered ? `The server holds no ${q.data?.provider ?? "model"} key yet.` : "";
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Agent" scroll>
      <View>
        <T tone="faint" size={13} className="pb-1">Effort</T>
        {EFFORTS.map((e) => {
          const on = effort === e;
          return (
            <ListRow key={e} title={cap(e)} subtitle={EFFORT[e].about} selected={on}
              onPress={() => { Haptics.selectionAsync(); usePrefs.getState().set({ agentEffort: e }); }}
              trailing={on ? <Check size={20} color={C.brand} strokeWidth={2.6} /> : null} className="-mx-5 px-5" />
          );
        })}
        <T tone="faint" size={13} className="pb-1 pt-4">Model</T>
        {ids.map((id) => {
          const on = model === id;
          return (
            <ListRow key={id} title={id} subtitle={id === offered?.default ? "Default" : undefined} selected={on} onPress={() => pick(id)}
              trailing={on ? <Check size={20} color={C.brand} strokeWidth={2.6} /> : null} className="-mx-5 px-5" />
          );
        })}
        {note ? <T tone="faint" size={13} className="py-2">{note}</T> : null}
      </View>
    </Sheet>
  );
}
