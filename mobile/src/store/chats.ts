// Ask-tab chats, kept on the server as `chats` records: the server agent writes each reply and the title back, so a
// chat reads the same on the phone and the laptop. The phone holds the list as the server last said it, the open
// chat's messages, and which chat is open (MMKV, so a relaunch comes back to it). A new chat gets its id here and
// its record just before its first message goes (ensureChat, from the transport in src/store/agent.ts). A message
// handed over from elsewhere (Home's box, a share) waits in `pending` until the Ask tab sends it; a draft (a note's
// "Ask about this note") waits in `draft` until the Ask tab puts it in its field. When Ask opens on a new chat instead
// of the last one is the `newChatOn` pref (`enterAsk`).
import type { UIMessage } from "ai";
import { AppState } from "react-native";
import { create } from "zustand";
import * as pb from "@/core/pocketbase";
import { chatTitle } from "@/core/share";
import { serverOf } from "./keys";
import type { LiveEvent } from "./live";
import { usePrefs } from "./prefs";
import { mmkvStorage } from "./storage";

const { mmkv } = mmkvStorage("chat");
const CURRENT = "current";
/** When the chat was last on screen (ms), and whether the app went to the background since: kept across a relaunch, so
 *  a killed app counts as left. */
const SEEN = "seen", LEFT = "left";

/** When Ask opens on a new chat rather than the last one (Settings > Agent): each time the tab is opened, once the
 *  app has been left, once the chat has been off screen for `IDLE_MS`, or only from the New chat button. */
export type NewChatOn = "tab" | "app" | "idle" | "never";
export const IDLE_MS = 30 * 60_000;

AppState.addEventListener("change", (s) => { if (s === "background") mmkv.set(LEFT, "1"); });

/** The chat on the Ask tab. `state`: its messages are loading, here, or failed to load — and a chat whose history
 *  didn't load can't be sent to, or the server would save it without that history. */
export type Current = { id: string; messages: UIMessage[]; state: "loading" | "ready" | "error"; err?: string };

type S = {
  chats: pb.ChatRec[];        // newest first, as the server last said
  current: Current;
  refresh: () => Promise<void>;
  open: (id: string) => void;
  fresh: () => void;
  /** An explicit history selection or handoff survives the next Ask focus. */
  resumeOnEntry: boolean;
  /** Ask is on screen: by opening the tab (`via` "tab") or by coming back to the app on it ("app"). Starts a fresh
   *  chat when `newChatOn` says it is due, and returns whether it did. Never switches a reply in flight. */
  enterAsk: (streaming: boolean, via: "tab" | "app") => boolean;
  /** Ask went off screen (another tab, or the app left from it): the idle clock starts. */
  leaveAsk: () => void;
  /** A message the Ask tab sends as soon as it is in front and idle (`startWith`), then clears. */
  pending: string | null;
  /** Hand the agent a first message: a fresh chat opens with it on the Ask tab, unless `join` (a reply is streaming,
   *  which a switch would cut off), when it goes into the chat on screen once that reply ends. */
  startWith: (text: string, join: boolean) => void;
  /** Text for the Ask tab's message field, not sent: a note's "Ask about this note" (`startDraft`), taken by the tab. An object, so the same text handed twice is two drafts. */
  draft: { text: string } | null;
  /** The same hand-over as `startWith`, but the owner finishes the message: a fresh chat opens with `text` in the field
   *  (or the open one, when `join`). */
  startDraft: (text: string, join: boolean) => void;
  remove: (id: string) => Promise<void>;
};

/** Chats known to have a record: listed, loaded, or made by ensureChat. */
const onServer = new Set<string>();

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function load(id: string) {
  const s = serverOf();
  if (!s) { useChats.setState({ current: { id, messages: [], state: "error", err: "Set the notes server in Settings." } }); return; }
  pb.chat(s, id).then((c) => {
    if (useChats.getState().current.id !== id) return;          // switched away meanwhile
    if (c) onServer.add(id);
    useChats.setState({ current: { id, messages: (c?.messages ?? []) as UIMessage[], state: "ready" } });
  }, (e) => {
    if (useChats.getState().current.id === id) useChats.setState({ current: { id, messages: [], state: "error", err: msg(e) } });
  });
}

function pick(id: string, messages: UIMessage[] = [], state: Current["state"] = "loading"): Current {
  mmkv.set(CURRENT, id);
  return { id, messages, state };
}

const sorted = (xs: pb.ChatRec[]) => [...xs].sort((a, b) => b.updated.localeCompare(a.updated));

export const useChats = create<S>()((set, get) => ({
  chats: [],
  current: { id: mmkv.getString(CURRENT) ?? pb.recordId(), messages: [], state: "loading" },
  refresh: async () => {
    const s = serverOf();
    if (!s) return;
    const chats = await pb.chats(s);
    chats.forEach((c) => onServer.add(c.id));
    set({ chats });
  },
  resumeOnEntry: false,
  enterAsk: (streaming, via) => {
    const { pending, draft, resumeOnEntry } = get();
    const on = usePrefs.getState().newChatOn, left = mmkv.getString(LEFT) === "1", seen = Number(mmkv.getString(SEEN) ?? 0);
    const due = on === "tab" ? via === "tab" : on === "app" ? left : on === "idle" ? Date.now() - seen >= IDLE_MS : false;
    const reset = due && !streaming && !pending && !draft && !resumeOnEntry;
    if (reset) get().fresh();
    mmkv.remove(LEFT);
    mmkv.set(SEEN, String(Date.now()));
    set({ resumeOnEntry: false });
    return reset;
  },
  leaveAsk: () => mmkv.set(SEEN, String(Date.now())),
  open: (id) => { set({ current: pick(id), resumeOnEntry: true }); load(id); },
  fresh: () => set({ current: pick(pb.recordId(), [], "ready") }),
  pending: null,
  startWith: (text, join) => { if (!join) get().fresh(); set({ pending: text, resumeOnEntry: true }); },
  draft: null,
  startDraft: (text, join) => { if (!join) get().fresh(); set({ draft: { text }, resumeOnEntry: true }); },
  remove: async (id) => {
    const s = serverOf();
    if (s) await pb.removeChat(s, id);
    onServer.delete(id);
    set({ chats: get().chats.filter((c) => c.id !== id) });
    if (get().current.id === id) get().fresh();
  },
}));

load(useChats.getState().current.id);

/** The record a send names, made empty if it isn't there yet, titled by its first message until the server retitles it. */
export async function ensureChat(s: pb.Server, id: string, messages: UIMessage[]): Promise<void> {
  if (onServer.has(id)) return;
  const first = messages.find((m) => m.role === "user")?.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ") ?? "";
  await pb.createChat(s, id, chatTitle(first).slice(0, 80));
  onServer.add(id);
}

/** The realtime feed's `chats` events (src/store/live.ts): the list follows; the open chat takes the server's
 *  messages (the Ask tab applies them when idle). A new connection may have missed some: list and reload. */
export function heardChats(events: LiveEvent[]) {
  const { current } = useChats.getState();
  if (events.some((e) => e.topic === "connect")) {
    useChats.getState().refresh().catch(() => {});
    if (current.state !== "loading" && onServer.has(current.id)) load(current.id);
  }
  for (const e of events) {
    const r = e.record;
    if (e.topic !== "chats" || typeof r?.id !== "string") continue;
    const rest = useChats.getState().chats.filter((c) => c.id !== r.id);
    if (e.action === "delete") {
      onServer.delete(r.id);
      useChats.setState({ chats: rest });
      continue;
    }
    onServer.add(r.id);
    useChats.setState({ chats: sorted([{ id: r.id, title: r.title ?? "", updated: r.updated ?? "" }, ...rest]) });
    if (r.id === useChats.getState().current.id && Array.isArray(r.messages))
      useChats.setState({ current: { id: r.id, messages: r.messages, state: "ready" } });
  }
}
