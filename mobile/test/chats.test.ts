import { beforeEach, expect, it, vi } from "vitest";

// The chat file, the prefs and the app's state listener, shared with the mocks (hoisted above the imports)
const { file, prefs, app } = vi.hoisted(() => ({ file: new Map<string, string>(), prefs: { newChatOn: "tab" }, app: { change: (_: string) => {} } }));
const toApp = (s: string) => app.change(s);
vi.mock("@/store/storage", () => ({
  mmkvStorage: () => ({ mmkv: { getString: (k: string) => file.get(k), set: (k: string, v: string) => void file.set(k, v), remove: (k: string) => void file.delete(k) } }),
}));
vi.mock("@/store/keys", () => ({ serverOf: () => null }));
vi.mock("@/store/prefs", () => ({ usePrefs: { getState: () => prefs } }));
vi.mock("react-native", () => ({ AppState: { addEventListener: (_: string, f: (s: string) => void) => { app.change = f; } } }));

import { IDLE_MS, useChats } from "@/store/chats";

beforeEach(() => {
  vi.useRealTimers();
  file.clear();
  prefs.newChatOn = "tab";
  useChats.setState({ pending: null, draft: null, resumeOnEntry: false });
  useChats.getState().fresh();
});

it("marks a history selection to survive entry into Ask", () => {
  useChats.getState().open("saved-chat");
  expect(useChats.getState().current.id).toBe("saved-chat");
  expect(useChats.getState().resumeOnEntry).toBe(true);
});

it("preserves a handoff and gives it a fresh conversation", () => {
  const previous = useChats.getState().current.id;
  useChats.getState().startWith("Find my note", false);
  expect(useChats.getState().current.id).not.toBe(previous);
  expect(useChats.getState()).toMatchObject({ pending: "Find my note", resumeOnEntry: true });
});

it("keeps a streaming conversation when a draft joins it", () => {
  const previous = useChats.getState().current.id;
  useChats.getState().startDraft("About this note", true);
  expect(useChats.getState().current.id).toBe(previous);
  expect(useChats.getState()).toMatchObject({ draft: { text: "About this note" }, resumeOnEntry: true });
});

it("starts fresh on an ordinary return, preserving explicitly selected chats for one entry", () => {
  const first = useChats.getState().current.id;
  expect(useChats.getState().enterAsk(false, "tab")).toBe(true);
  expect(useChats.getState().current.id).not.toBe(first);
  useChats.getState().open("saved-chat");
  expect(useChats.getState().enterAsk(false, "tab")).toBe(false);
  expect(useChats.getState().current.id).toBe("saved-chat");
  expect(useChats.getState().enterAsk(false, "tab")).toBe(true);
});

it("does not interrupt a streaming reply or discard a pending handoff", () => {
  const first = useChats.getState().current.id;
  expect(useChats.getState().enterAsk(true, "tab")).toBe(false);
  expect(useChats.getState().current.id).toBe(first);
  useChats.getState().startWith("Find my note", false);
  const handed = useChats.getState().current.id;
  expect(useChats.getState().enterAsk(false, "tab")).toBe(false);
  expect(useChats.getState().current.id).toBe(handed);
  expect(useChats.getState().pending).toBe("Find my note");
});

it("on 'tab', starts over on opening the tab but not on coming back to the app", () => {
  expect(useChats.getState().enterAsk(false, "app")).toBe(false);
  expect(useChats.getState().enterAsk(false, "tab")).toBe(true);
});

it("on 'app', keeps the chat across tabs and starts over once the app was left", () => {
  prefs.newChatOn = "app";
  const first = useChats.getState().current.id;
  useChats.getState().leaveAsk();
  expect(useChats.getState().enterAsk(false, "tab")).toBe(false);
  expect(useChats.getState().current.id).toBe(first);
  toApp("background");
  expect(useChats.getState().enterAsk(false, "app")).toBe(true);
  expect(useChats.getState().current.id).not.toBe(first);
  expect(useChats.getState().enterAsk(false, "tab")).toBe(false);   // the leave is used up
});

it("on 'idle', starts over only after the chat was off screen long enough", () => {
  prefs.newChatOn = "idle";
  vi.useFakeTimers();
  useChats.getState().enterAsk(false, "tab");
  useChats.getState().leaveAsk();
  vi.advanceTimersByTime(IDLE_MS - 1000);
  expect(useChats.getState().enterAsk(false, "app")).toBe(false);
  useChats.getState().leaveAsk();
  vi.advanceTimersByTime(IDLE_MS);
  expect(useChats.getState().enterAsk(false, "tab")).toBe(true);
});

it("on 'never', keeps the chat however Ask is reached", () => {
  prefs.newChatOn = "never";
  toApp("background");
  expect(useChats.getState().enterAsk(false, "tab")).toBe(false);
  expect(useChats.getState().enterAsk(false, "app")).toBe(false);
});
