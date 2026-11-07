// A reply keeps going when the app is left. The agent runs on the server, but its answer streams into this process,
// and Android freezes a backgrounded app within seconds (React Native stops JS timers once it's paused, and a frozen
// app's stream dies with the connection), so while a reply streams a foreground service holds the process up
// (react-native-background-actions — a HeadlessJS task, which also keeps the timers running) behind an ongoing
// "answering" notification. When the reply ends and the user isn't on the chat, a notification says so;
// tapping it opens that chat. The one handler for notification taps lives here too: a task reminder opens its task.
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";
import { AppState, NativeModules } from "react-native";
import BackgroundService from "react-native-background-actions";
import { isToolUIPart, type ChatTransport, type UIMessage } from "ai";
import { create } from "zustand";
import { useChats } from "@/store/chats";
import { tapOf } from "@/store/reminder-route";
import { openTask } from "@/ui/tasks";
import { usePrefs } from "@/store/prefs";
import { THEMES, withAccent } from "@/core/theme";

/** Notifications are drawn by the system, outside the app's screens: tinted with the chosen theme's brand at the time. */
const brand = () => {
  const { theme, accent } = usePrefs.getState();
  return withAccent(THEMES[theme] ?? THEMES.oled, accent ?? "theme").C.brand;
};

const CHANNEL = "replies";

/** plugins/live-update.js: re-posts the service's notification as an Android 16 Live Update; false where it can't (older Android, promotion off). */
const LiveUpdate = NativeModules.LiveUpdate as
  | { show(title: string, text: string, chip: string, color: string, uri: string): Promise<boolean>; hide(): void }
  | undefined;

/** Whether the Ask tab has focus — set by the screen; with the app in front, that's the user watching. */
export const seen = { ask: false };

/** An answer finished while the user wasn't looking at Ask: the tab shows a dot until they open it (cleared by the tab bar). */
export const useAskBadge = create<{ unread: boolean }>()(() => ({ unread: false }));

/** The service didn't start for the last turn: Ask says the reply won't survive leaving the app. */
export const useService = create<{ failed: boolean }>()(() => ({ failed: false }));

let streaming: string | undefined;     // the chat a reply is streaming in, from the request itself
let deferred: string | undefined;      // a notification tapped mid-reply: its chat opens when the reply ends

/** The chat the reply in flight was sent from — a switch mid-reply can't get the reply filed under the new chat. */
export const replying = () => streaming;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

let asked = false;
/** Once, on the first message: Android 13+ only shows its permission prompt after a channel exists. */
async function permit() {
  if (asked) return;
  asked = true;
  await Notifications.setNotificationChannelAsync(CHANNEL, { name: "Agent replies", importance: Notifications.AndroidImportance.HIGH });
  await Notifications.requestPermissionsAsync();
}

type Run = { done: boolean; release?: () => void };
let run: Run | undefined;

/** Start the service for a turn — always from a user action, so in the foreground (Android 12+ refuses it from the background). */
function hold() {
  permit().catch(() => {});
  if (run) return;
  const r: Run = { done: false };
  run = r;
  const title = "Agent is answering", text = "It keeps going if you leave the app.", color = brand(), uri = "tefnotes://ask";
  BackgroundService.start(() => new Promise<void>((res) => { if (r.done) res(); else r.release = res; }), {
    taskName: "reply", taskTitle: title, taskDesc: text,
    taskIcon: { name: "notification_icon", type: "drawable" }, color, linkingURI: uri,
    progressBar: { max: 0, value: 0, indeterminate: true }, foregroundServiceType: ["dataSync"],
  }).then(() => {
    useService.setState({ failed: false });
    // A Live Update only while the reply streams: posted over the service's notification once it is up; the service's stop
    // removes it, and one posted just as the reply ended is cancelled here.
    if (!r.done) LiveUpdate?.show(title, text, "Reply", color, uri).then(() => { if (r.done) LiveUpdate.hide(); }, () => {});
  }, () => { if (run === r) run = undefined; useService.setState({ failed: true }); });
}

/** The task resolves and the library stops the service; one that hasn't started yet resolves as soon as it does. */
function letGo() {
  const r = run;
  run = undefined;
  if (!r) return;
  r.done = true;
  r.release?.();
}

/** Every request — send, regenerate, the resend after an approval — holds the service up and marks its chat busy. */
export function held<M extends UIMessage>(t: ChatTransport<M>): ChatTransport<M> {
  return { ...t, sendMessages: (o) => { streaming = o.chatId; hold(); return t.sendMessages(o); } };
}

const plain = (md: string) => md.replace(/[*_`#>|[\]]/g, "").replace(/\s+/g, " ").trim();

/** A reply ended (call after saving it): let the service go, open a chat whose notification was tapped meanwhile,
 *  and say so unless the user is looking at the chat (or stopped it themselves). */
export function replied(chat: string, { message, isAbort, isError }: { message: UIMessage; isAbort: boolean; isError: boolean }) {
  letGo();
  streaming = undefined;
  if (deferred) { useChats.getState().open(deferred); deferred = undefined; }
  if (isAbort || (AppState.currentState === "active" && seen.ask)) return;
  useAskBadge.setState({ unread: true });
  const waiting = message.parts.some((p) => isToolUIPart(p) && p.state === "approval-requested");
  const text = plain(message.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join(" "));
  Notifications.scheduleNotificationAsync({
    content: {
      title: isError ? "The reply failed" : waiting ? "Waiting for your OK" : "Answer ready",
      body: (isError ? "Open the chat to retry." : text || "Open the chat to see it.").slice(0, 160),
      data: { chat }, color: brand(),
    },
    trigger: { channelId: CHANNEL },
  }).catch(() => {});
}

/** Tapping a notification opens what it is about — also when it cold-starts the app: a reply's chat (not mid-reply:
 *  switching then would cut that reply off, so its chat opens when the reply ends), or a task reminder's task. */
export function useNotificationTaps() {
  useEffect(() => {
    const open = (n: Notifications.Notification) => {
      const tap = tapOf(n.request.content.data);
      if (!tap) return;
      if (tap.to === "task") { openTask(tap.id); return; }
      if (streaming) deferred = tap.id;
      else useChats.getState().open(tap.id);
      router.navigate("/ask");
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) open(last.notification);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification));
    return () => sub.remove();
  }, []);
}
