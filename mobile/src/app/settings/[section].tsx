// One Settings category's page (ui/settings.tsx `SECTIONS`); Back returns to the Settings tab.
import { useLocalSearchParams } from "expo-router";
import { ScrollView, View } from "react-native";
import { ScreenHeader } from "@/ui/ds";
import { goBack } from "@/ui/note";
import { SECTIONS, type SectionId } from "@/ui/settings";

export default function SettingsSection() {
  const { section } = useLocalSearchParams<{ section: string }>();
  const s = SECTIONS[section as SectionId] ?? SECTIONS.appearance;
  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title={s.title} compact back={() => goBack("/settings")} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 20 }} keyboardShouldPersistTaps="handled">
        <s.Page />
      </ScrollView>
    </View>
  );
}
