// The widgets' wiring, from the entry point (index.ts) so it runs both when the app starts and when Android starts the
// JS for a widget alone: the task handler, and a redraw of every placed widget whenever the tasks, the theme or the
// day may have changed while the app runs.
import { AppState } from "react-native";
import { registerWidgetTaskHandler, requestWidgetUpdate } from "react-native-android-widget";
import { useLenses } from "@/store/lenses";
import { usePrefs } from "@/store/prefs";
import { useTodo } from "@/store/todo";
import { QUICK_WIDGET, TODAY_WIDGET } from "./config";
import { widgetFor } from "./draw";
import { widgetTask } from "./handler";

const redraw = (names: string[]) => {
  for (const widgetName of names) void requestWidgetUpdate({ widgetName, renderWidget: widgetFor }).catch(() => {});
};

/** A burst of store writes (a sync refreshes it more than once) is one redraw. */
const SETTLE = 400;
let timer: ReturnType<typeof setTimeout> | undefined;
const soon = (names: string[]) => { clearTimeout(timer); timer = setTimeout(() => redraw(names), SETTLE); };

export function registerWidgets() {
  registerWidgetTaskHandler(widgetTask);
  useTodo.subscribe((s, was) => { if (s.tasks !== was.tasks) soon([TODAY_WIDGET]); });
  usePrefs.subscribe((s, was) => {
    if (s.theme !== was.theme || s.accent !== was.accent) soon([TODAY_WIDGET, QUICK_WIDGET]);
    else if (s.lensRec !== was.lensRec) soon([TODAY_WIDGET]);
  });
  useLenses.subscribe((s, was) => { if (s.lenses !== was.lenses) soon([TODAY_WIDGET]); });
  // Leaving the app: the day may have turned while it was open, and a timer may not run in the background
  AppState.addEventListener("change", (s) => { if (s === "background") redraw([TODAY_WIDGET]); });
}
