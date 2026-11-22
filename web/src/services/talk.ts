// Talk's calls to the agent (contract: core/talk.ts): whether the server has it, and the socket of one conversation. The socket is on
// the page's own origin like every other call, and the server refuses one whose Origin isn't its own.
import { FISH_USAGE, fishUsageOf, type FishUsage } from "@/core/fish-usage";
import { talkStatusOf, talkVoicesOf, type TalkStatus, type TalkVoice } from "@/core/talk";
import type { Deps } from "@/lib/talk-session";
import { api, orNull } from "./api";

/** The speech model the server talks through; null when the server has no key for one (Talk is off). */
export async function status(): Promise<TalkStatus | null> {
  const r = await orNull(api.get("/agent/talk", { baseURL: "" }));
  return r && talkStatusOf(r.data);
}

/** The socket to `/agent/talk`, its frames text (JSON) or binary (audio, as an ArrayBuffer). */
export const open: Deps["open"] = (on) => {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/agent/talk`);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => on.open();
  ws.onmessage = (e: MessageEvent<string | ArrayBuffer>) => on.message(e.data);
  ws.onclose = () => on.close();
  return {
    send: (data) => { if (ws.readyState === WebSocket.OPEN) ws.send(data); },
    close: () => { ws.onopen = ws.onmessage = ws.onclose = null; ws.close(); },
  };
};

/** The Fish voices to pick from, the owner's own first; `q` narrows them by name. */
export async function voices(q: string): Promise<TalkVoice[]> {
  const r = await api.get("/agent/talk/voices", { baseURL: "", params: q ? { q } : {} });
  return talkVoicesOf(r.data);
}

/** What Fish has cost since `week` and `month` began (ms), and its balance; null when the server has no Fish key. */
export async function fishUsage(starts: { week: number; month: number }): Promise<FishUsage | null> {
  const r = await orNull(api.get(FISH_USAGE, { baseURL: "", params: starts }));
  return r && fishUsageOf(r.data);
}
