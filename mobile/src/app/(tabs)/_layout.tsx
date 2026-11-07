// Bottom nav: a floating pill, iOS-style. The active tab's icon and label sit on a brand-tinted capsule, the rest are icons
// alone; a light tick under the finger. Drawn in JS over expo-router's Tabs (the bar is ours, the navigator theirs). Home
// first (the day at a glance, every note, and Search as its drawer), then Tasks (the `today` route: its pager of lists),
// Ask and Settings. The lens is Home's alone (picked and shown there); the bar never shows it. Colours follow the theme; icons are lucide.
import * as Haptics from "expo-haptics";
import { Tabs, usePathname } from "expo-router";
import { Home, ListChecks, Settings, Sparkles, type LucideIcon } from "lucide-react-native";
import { useEffect, type ComponentProps } from "react";
import { Pressable, View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAskBadge } from "@/agent/background";
import { cn, T } from "@/ui/ds";
import { useTheme } from "@/ui/use-theme";

const TABS: Record<string, { label: string; icon: LucideIcon }> = {
  home: { label: "Home", icon: Home },
  today: { label: "Tasks", icon: ListChecks }, ask: { label: "Ask", icon: Sparkles }, settings: { label: "Settings", icon: Settings },
};

type BarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

function PillBar({ state, navigation }: BarProps) {
  const { C } = useTheme();
  const insets = useSafeAreaInsets();
  // Hidden under the keyboard, so a composer sits on the keys
  const keyboard = useKeyboardState((s) => s.isVisible);
  const unread = useAskBadge((s) => s.unread);
  if (keyboard) return null;
  return (
    <View className="bg-bg px-4 pt-3" style={{ paddingBottom: insets.bottom + 10 }}>
      <View className="flex-row items-center justify-between rounded-full border border-line bg-raised p-1.5"
        style={{ elevation: 12, shadowColor: "black", shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } }}>
        {state.routes.map((route, i) => {
          const tab = TABS[route.name];
          if (!tab) return null;
          const focused = state.index === i;
          const Icon = tab.icon;
          const press = () => {
            void Haptics.selectionAsync();
            const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!focused && !e.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          return (
            <Pressable key={route.key} onPress={press} accessibilityRole="tab" accessibilityState={{ selected: focused }}
              accessibilityLabel={route.name === "ask" && unread ? `${tab.label}, new answer` : tab.label}
              className={cn("h-12 flex-row items-center justify-center gap-2 rounded-full", focused ? "bg-accent px-4" : "px-3")}>
              <Icon size={22} color={focused ? C.brand : C.dim} strokeWidth={focused ? 2.4 : 2} />
              {focused ? <T font="semi" size={14} style={{ color: C.brand }}>{tab.label}</T> : null}
              {route.name === "ask" && unread ? <View className="absolute right-2 top-2 h-2 w-2 rounded-full bg-warn" /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  // A dot on Ask for an answer that finished elsewhere; opening the tab reads it.
  const unread = useAskBadge((s) => s.unread);
  const onAsk = usePathname() === "/ask";
  useEffect(() => { if (onAsk && unread) useAskBadge.setState({ unread: false }); }, [onAsk, unread]);
  return (
    <Tabs tabBar={(p) => <PillBar {...p} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="home" />
      <Tabs.Screen name="today" />
      <Tabs.Screen name="ask" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
