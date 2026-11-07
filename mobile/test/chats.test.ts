import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/store/storage", () => ({ mmkvStorage: () => ({ mmkv: { getString: () => undefined, set: vi.fn() } }) }));
vi.mock("@/store/keys", () => ({ serverOf: () => null }));

import { useChats } from "@/store/chats";

beforeEach(() => {
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
  expect(useChats.getState().enterAsk(false)).toBe(true);
  expect(useChats.getState().current.id).not.toBe(first);
  useChats.getState().open("saved-chat");
  expect(useChats.getState().enterAsk(false)).toBe(false);
  expect(useChats.getState().current.id).toBe("saved-chat");
  expect(useChats.getState().enterAsk(false)).toBe(true);
});

it("does not interrupt a streaming reply or discard a pending handoff", () => {
  const first = useChats.getState().current.id;
  expect(useChats.getState().enterAsk(true)).toBe(false);
  expect(useChats.getState().current.id).toBe(first);
  useChats.getState().startWith("Find my note", false);
  const handed = useChats.getState().current.id;
  expect(useChats.getState().enterAsk(false)).toBe(false);
  expect(useChats.getState().current.id).toBe(handed);
  expect(useChats.getState().pending).toBe("Find my note");
});
