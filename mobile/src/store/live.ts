// The server's realtime feed (PocketBase's SSE endpoint) while the app is in front: a note, a photo, a chat, a task or
// a link changed —
// on the laptop, by the server's agent, or this phone's own push echoing back. The events are handed over as they came, so the caller can
// tell an echo from news and skip a sync for it. The feed drops now and then (PocketBase closes idle ones); each new
// connection subscribes again and says so (`connect`), for a catch-up. A failing one retries on a growing delay, and
// at once when the network comes back (a stream that died with it never says so).
import * as Network from "expo-network";
import { useEffect } from "react";
import { AppState } from "react-native";
import EventSource from "react-native-sse";
import { useKeys } from "./keys";

const TOPICS = ["notes", "attachments", "chats", "tasks", "links"] as const;
type Kind = (typeof TOPICS)[number];
type Topic = "PB_CONNECT" | Kind;

/** What the feed said: `connect` for a fresh subscription, else the record's topic, the action and the record as PocketBase sent it. */
export type LiveEvent = { topic: "connect" | Kind; action?: string; record?: any };

/** Bursts (a pull's own writes, a laptop saving twice) become one call. */
const SETTLE = 1000;
const RETRY = 5000, RETRY_MAX = 5 * 60_000;

/** `onChange` with the events of the last moment, whenever the server's notes, photos, chats, tasks or links change,
 *  while a server is set.
 *  Stable between renders, or the feed reconnects. */
export function useLive(onChange: (events: LiveEvent[]) => void) {
  const url = useKeys((s) => s.keys.server);
  useEffect(() => {
    if (!url) return;
    let es: EventSource<Topic> | null = null, timer: ReturnType<typeof setTimeout> | undefined, retry: ReturnType<typeof setTimeout> | undefined;
    const heard: LiveEvent[] = [];
    let wait = RETRY;
    const hear = (e: LiveEvent) => { heard.push(e); clearTimeout(timer); timer = setTimeout(() => onChange(heard.splice(0)), SETTLE); };
    const record = (topic: Kind) => (ev: { data: string | null }) => {
      try { hear({ topic, ...JSON.parse(ev.data ?? "") }); } catch { hear({ topic }); }     // unreadable: unknown, so worth a look
    };
    const open = () => {
      close();
      es = new EventSource<Topic>(`${url}/api/realtime`, { pollingInterval: RETRY });
      es.addEventListener("open", () => { wait = RETRY; });
      const mine = es;
      es.addEventListener("error", () => {
        // The library repolls every `pollingInterval` for ever: it is stopped (after it has queued that) and the retry is ours
        setTimeout(() => {
          if (es !== mine) return;                    // already closed, or replaced
          const after = wait;
          wait = Math.min(wait * 2, RETRY_MAX);
          close(); retry = setTimeout(open, after);
        }, 0);
      });
      es.addEventListener("PB_CONNECT", (ev) => {
        const clientId = ev.data ? JSON.parse(ev.data).clientId : null;
        if (!clientId) return;
        fetch(`${url}/api/realtime`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, subscriptions: TOPICS }),
        }).then(() => hear({ topic: "connect" }), () => {});
      });
      for (const t of TOPICS) es.addEventListener(t, record(t));
    };
    const close = () => { clearTimeout(retry); es?.removeAllEventListeners(); es?.close(); es = null; };
    if (AppState.currentState === "active") open();
    const app = AppState.addEventListener("change", (st) => { if (st === "active") { if (!es) open(); } else close(); });
    const net = Network.addNetworkStateListener((st) => {
      if (st.isConnected && st.isInternetReachable !== false && AppState.currentState === "active") { wait = RETRY; open(); }
    });
    return () => { app.remove(); net.remove(); close(); clearTimeout(timer); };
  }, [url, onChange]);
}
