// The widgets as Android declares them, read by app.config.ts (react-native-android-widget's config plugin) and by the
// code that draws them: one name each. No runtime import: app.config.ts loads this under Node.
// Both go on the home screen and on the lock screen (Android 16 QPR2 shows any widget there, sized about 4 x 3 cells;
// `keyguard` opts in for hosts that filter on it). A tap that opens the app from the lock screen asks to unlock first.
import type { WithAndroidWidgetsParams } from "react-native-android-widget";

export const TODAY_WIDGET = "TodayWidget";
export const QUICK_WIDGET = "QuickWidget";

/** Atkinson Hyperlegible Next, the app's face, by weight: the widget names a font by its file under assets/fonts. */
export const WIDGET_FONT = {
  regular: "AtkinsonHyperlegibleNext_400Regular",
  semi: "AtkinsonHyperlegibleNext_600SemiBold",
  bold: "AtkinsonHyperlegibleNext_700Bold",
} as const;

export const widgetConfig: WithAndroidWidgetsParams = {
  fonts: Object.values(WIDGET_FONT).map((f) => `./assets/fonts/${f}.ttf` as const),
  widgets: [
    {
      name: TODAY_WIDGET,
      label: "Today",
      description: "Today's tasks: tick them off, or tap one to open it.",
      minWidth: "180dp",
      minHeight: "110dp",
      targetCellWidth: 4,
      targetCellHeight: 2,
      resizeMode: "horizontal|vertical",
      widgetCategory: "home_screen|keyguard",
      // Redrawn every half hour (the shortest Android allows) so the day turns over, and synced then
      updatePeriodMillis: 30 * 60 * 1000,
    },
    {
      name: QUICK_WIDGET,
      label: "Ask and new note",
      description: "Ask the agent, or start a note.",
      minWidth: "110dp",
      minHeight: "40dp",
      targetCellWidth: 2,
      targetCellHeight: 1,
      resizeMode: "horizontal|vertical",
      widgetCategory: "home_screen|keyguard",
    },
  ],
};
