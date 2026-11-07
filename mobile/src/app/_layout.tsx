import "../global.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { router, Stack, usePathname } from "expo-router";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import { StatusBar } from "expo-status-bar";
import { useEffect, useEffectEvent } from "react";
import { useNotificationTaps } from "@/agent/background";
import { useRouteSeen } from "@/agent/ui-tools";
import { fromIntent } from "@/core/share";
import { heardChats } from "@/store/chats";
import { useLensSync } from "@/store/lenses";
import { useLive, type LiveEvent } from "@/store/live";
import { heard, useNoteSync } from "@/store/notes";
import { useReminders } from "@/store/reminders";
import { queryClient, useAppFocus } from "@/store/query";
import { useShare } from "@/store/share";
import { useTagSync } from "@/store/tags";
import { heardTodo, useTodoSync } from "@/store/todo";
import { DesignSystemProvider } from "@/ui/ds";
import { applySavedTheme, useLensLook, useTheme } from "@/ui/use-theme";

// The owner's theme (Settings > Appearance), before the first frame: never the OS scheme, which Uniwind would follow.
applySavedTheme();

/** The server's realtime feed, one connection for all: notes and photos to their sync, chats to their list, tasks to theirs. */
const onLive = (events: LiveEvent[]) => { heard(events); heardChats(events); heardTodo(events); };

// The tabs sit under every other screen, also one a link opens cold (/note/<id>, /chats): Back has somewhere to go
export const unstable_settings = { initialRouteName: "(tabs)" };

/** A share from another app: copied into the app's own store and the Share screen opened on it, once per share.
 *  Cold starts land on /share already (+native-intent.ts); a running app is sent there. */
function ShareWatcher() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const pathname = usePathname();
  const take = useEffectEvent(() => {
    const s = fromIntent(shareIntent);
    resetShareIntent();
    if (!s) return;
    useShare.setState({ shared: s });
    if (pathname !== "/share") router.push("/share");
  });
  useEffect(() => { if (hasShareIntent) take(); }, [hasShareIntent]);
  return null;
}

export default function Root() {
  useAppFocus();   // queries (the agent's models) pause while the app is in the background
  useNoteSync();   // notes pull on foreground, push on background
  useTodoSync();   // tasks the same
  useLive(onLive); // and whenever the server says a note, photo, chat or task changed
  useTagSync();    // tag colours, read on launch and foreground
  useLensSync();   // the lens definitions the same
  useLensLook();   // and the active lens's colour on screen
  useRouteSeen();  // the screen the assistant's context names (the last one before Ask)
  useNotificationTaps();  // a "reply ready" notification opens its chat, a task reminder its task
  useReminders();  // open tasks with a time ring then
  const { C, scheme } = useTheme();
  return (
    // The share provider outermost, as its docs ask; queries next: the design system's portal host (dialogs, menus)
    // renders its content outside its own children
    <ShareIntentProvider>
      <QueryClientProvider client={queryClient}>
        <DesignSystemProvider>
          <StatusBar style={scheme === "dark" ? "light" : "dark"} />
          <ShareWatcher />
          {/* Android's own open/close motion ("default": on Android 13+ the system's, a short slide with a fade) for every pushed
              screen, a rise from the bottom for the Share sheet; the tabs are the base and never animate in. */}
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: "default" }}>
            <Stack.Screen name="index" options={{ animation: "none" }} />
            <Stack.Screen name="(tabs)" options={{ animation: "none" }} />
            <Stack.Screen name="share" options={{ animation: "slide_from_bottom" }} />
          </Stack>
        </DesignSystemProvider>
      </QueryClientProvider>
    </ShareIntentProvider>
  );
}
