// Drawing the widgets from the app's own copy of the data: the tasks store (store/todo.ts, SQLite) and the saved theme.
// The tasks the lens that is on shows (read synchronously from the prefs and the cached definitions, so a headless start has it too).
// Used by the task handler (handler.ts: Android asks) and by the app (register.ts: the data changed).
import type { WidgetInfo } from "react-native-android-widget";
import { withinLens } from "@/core/lens";
import { localDay } from "@/core/time";
import { dayTasks } from "@/core/today";
import { activeLensNow } from "@/store/lenses";
import { useTodo } from "@/store/todo";
import { savedTheme } from "@/ui/use-theme";
import { QUICK_WIDGET, TODAY_WIDGET } from "./config";
import { QuickWidget, TodayWidget } from "./widgets";

/** The widget `info` names, as it should look now. */
export function widgetFor(info: WidgetInfo) {
  const theme = savedTheme();
  if (info.widgetName === QUICK_WIDGET) return <QuickWidget theme={theme} width={info.width} />;
  if (info.widgetName !== TODAY_WIDGET) throw new Error(`widget: no widget named ${info.widgetName}`);
  const day = dayTasks([...withinLens(activeLensNow(), Object.values(useTodo.getState().tasks))], localDay());
  return <TodayWidget theme={theme} day={day} width={info.width} height={info.height} />;
}
