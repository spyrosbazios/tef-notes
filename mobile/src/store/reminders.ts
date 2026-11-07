// Task reminders as local notifications: an open task with a `when` day and a `remind` time rings then (core/things.ts
// reminderPlan: the next 30 days). They are all dropped and set again whenever the tasks change (a save, a sync) and when
// the app comes to the front, since the window moves with the date; nothing is rescheduled while the plan is as it was.
// Their own channel, "tasks", and ids starting `task:`; a tap opens the task (src/agent/background.ts, store/reminder-route.ts).
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { AppState } from "react-native";
import { reminderPlan } from "@/core/things";
import { useTodo } from "./todo";

const CHANNEL = "tasks";
const PREFIX = "task:";

let last = "";                                   // the plan as last scheduled
let queue: Promise<void> = Promise.resolve();    // one reschedule at a time

/** The channel (Android 13+ asks for permission only once one exists), then permission; whether notifications may show. */
async function allowed(): Promise<boolean> {
  await Notifications.setNotificationChannelAsync(CHANNEL, { name: "Task reminders", importance: Notifications.AndroidImportance.HIGH });
  const have = await Notifications.getPermissionsAsync();
  if (have.granted) return true;
  return have.canAskAgain ? (await Notifications.requestPermissionsAsync()).granted : false;
}

async function reschedule() {
  const { tasks } = useTodo.getState();
  const plan = reminderPlan(Object.values(tasks), new Date()).map((r) => ({ ...r, data: { task: r.task } }));
  const sig = JSON.stringify(plan);
  if (sig === last) return;
  if (plan.length && !(await allowed())) return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(scheduled.filter((n) => n.identifier.startsWith(PREFIX)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
  for (const r of plan) {
    await Notifications.scheduleNotificationAsync({
      identifier: r.id,
      content: { title: r.title, data: r.data },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at, channelId: CHANNEL },
    });
  }
  last = sig;
}

/** Mounted once, in the root layout. */
export function useReminders() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { queue = queue.then(reschedule).catch(() => {}); }, 1500);
    };
    soon();
    const off = useTodo.subscribe((s, was) => { if (s.tasks !== was.tasks) soon(); });
    const app = AppState.addEventListener("change", (s) => { if (s === "active") soon(); });
    return () => { clearTimeout(timer); off(); app.remove(); };
  }, []);
}
