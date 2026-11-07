// The Settings tab: a row per category (ui/settings.tsx `SECTIONS`), each opening its page (app/settings/[section].tsx).
import Constants from "expo-constants";
import { router } from "expo-router";
import { ScrollView, View } from "react-native";
import { ListRow, ListSection, ScreenHeader, T } from "@/ui/ds";
import { SECTIONS, type SectionId } from "@/ui/settings";

export default function SettingsScreen() {
  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title="Settings" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 20 }}>
        <ListSection>
          {(Object.keys(SECTIONS) as SectionId[]).map((id) => {
            const s = SECTIONS[id];
            return <ListRow key={id} title={s.title} subtitle={s.about} icon={s.icon} chevron onPress={() => router.push(`/settings/${id}`)} />;
          })}
        </ListSection>
        <T tone="faint" size={12} className="text-center">TEF Notes {Constants.expoConfig?.version ?? ""}</T>
      </ScrollView>
    </View>
  );
}
