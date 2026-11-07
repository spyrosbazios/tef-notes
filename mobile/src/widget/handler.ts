// What Android asks of the widgets, run as a headless JS task (the app need not be open): draw one that was added,
// resized or is due its half-hourly redraw, and take a tick from Today's. A tick is written as the app writes one
// (store/todo.ts) but at once: a widget has no take-back second, so a task ticked today stays listed, faded, and its box
// unticks it. A tick and the half-hourly redraw then sync (bounded: the task has 30 s), and the widget is drawn again
// with what came down.
import type { WidgetTaskHandlerProps } from "react-native-android-widget";
import { syncTodo, useTodo } from "@/store/todo";
import { widgetFor } from "./draw";
import { TICK } from "./widgets";

/** How long a widget's sync may take before the task ends without it; what is unsent goes up with the next sync. */
const SYNC_WITHIN = 20_000;

function toggle(id: unknown) {
  if (typeof id !== "string") return;
  const store = useTodo.getState(), t = store.tasks[id];
  if (!t) return;
  if (t.done) store.reopen(id);
  else store.complete(id);
}

export async function widgetTask({ widgetInfo, widgetAction, clickAction, clickActionData, renderWidget }: WidgetTaskHandlerProps) {
  if (widgetAction === "WIDGET_DELETED") return;
  const ticked = widgetAction === "WIDGET_CLICK" && clickAction === TICK;
  if (ticked) toggle(clickActionData?.id);
  renderWidget(widgetFor(widgetInfo));
  if (!ticked && widgetAction !== "WIDGET_UPDATE") return;
  await Promise.race([syncTodo(), new Promise((done) => setTimeout(done, SYNC_WITHIN))]);
  renderWidget(widgetFor(widgetInfo));
}
