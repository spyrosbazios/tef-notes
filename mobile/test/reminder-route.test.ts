// What a tapped notification opens (store/reminder-route.ts).
import { describe, expect, it } from "vitest";
import { tapOf } from "@/store/reminder-route";

describe("a notification tap", () => {
  it("opens the task or the chat its data names", () => {
    expect(tapOf({ task: "t1" })).toEqual({ to: "task", id: "t1" });
    expect(tapOf({ chat: "x" })).toEqual({ to: "chat", id: "x" });
    expect(tapOf({})).toBeNull();
    expect(tapOf(undefined)).toBeNull();
    expect(tapOf({ task: 5 })).toBeNull();
  });
});
