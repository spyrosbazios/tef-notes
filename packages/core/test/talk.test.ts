import { describe, expect, it } from "bun:test";
import { bytesOf, costOf, DEFAULT_TALK_MODEL, MIC_FRAME, TALK_RATE, talkClientEventOf, talkServerEventOf, talkStatusOf } from "../src/talk";

describe("talkClientEventOf", () => {
  it("reads a start, with the context only when it has a view", () => {
    expect(talkClientEventOf(JSON.stringify({ type: "start", chat: "c1", context: { view: { kind: "home" } } })))
      .toEqual({ type: "start", chat: "c1", context: { view: { kind: "home" } } });
    expect(talkClientEventOf({ type: "start", chat: "c1", context: { note: {} } })).toEqual({ type: "start", chat: "c1" });
  });

  it("reads a card's answer and a UI tool's output", () => {
    expect(talkClientEventOf({ type: "approval", id: "a1", approved: false, reason: "no" })).toEqual({ type: "approval", id: "a1", approved: false, reason: "no" });
    expect(talkClientEventOf({ type: "approval", id: "a1", approved: true })).toEqual({ type: "approval", id: "a1", approved: true });
    expect(talkClientEventOf({ type: "output", toolCallId: "t1", output: { ok: true } })).toEqual({ type: "output", toolCallId: "t1", output: { ok: true } });
  });

  it("refuses what is not an event", () => {
    for (const bad of ["not json", "[]", 5, null, { type: "start" }, { type: "approval", id: "a1" }, { type: "approval", id: "a1", approved: "yes" }, { type: "output", toolCallId: "t1" }, { type: "ready" }])
      expect(talkClientEventOf(bad)).toBeNull();
  });
});

describe("talkServerEventOf", () => {
  it("reads each event", () => {
    expect(talkServerEventOf('{"type":"ready"}')).toEqual({ type: "ready" });
    expect(talkServerEventOf({ type: "interrupted" })).toEqual({ type: "interrupted" });
    expect(talkServerEventOf({ type: "hearing", speaking: true })).toEqual({ type: "hearing", speaking: true });
    expect(talkServerEventOf({ type: "part", message: "m1", role: "assistant", index: 0, part: { type: "text", text: "Hi" } }))
      .toEqual({ type: "part", message: "m1", role: "assistant", index: 0, part: { type: "text", text: "Hi" } });
    expect(talkServerEventOf({ type: "usage", said: 1200, cost: 0.018 })).toEqual({ type: "usage", said: 1200, cost: 0.018 });
    expect(talkServerEventOf({ type: "error", message: "The voice hung up" })).toEqual({ type: "error", message: "The voice hung up" });
  });

  it("refuses a part it could not place, and counts nothing for a number that is not one", () => {
    for (const bad of [{ type: "part", message: "m1", role: "system", index: 0, part: { type: "text" } }, { type: "part", message: "m1", role: "user", index: -1, part: { type: "text" } }, { type: "part", message: "m1", role: "user", index: 0, part: {} }, { type: "start", chat: "c1" }, { type: "hearing", speaking: "yes" }])
      expect(talkServerEventOf(bad)).toBeNull();
    expect(talkServerEventOf({ type: "usage", said: "many", cost: -1 })).toEqual({ type: "usage", said: 0, cost: 0 });
  });
});

describe("talkStatusOf", () => {
  it("is the voice model and voice, and only an offered model", () => {
    expect(talkStatusOf({ model: "s2.1-pro", voice: "v1" })).toEqual({ model: "s2.1-pro", voice: "v1" });
    expect(talkStatusOf({ model: "s2.1-pro" })).toEqual({ model: "s2.1-pro", voice: "" });
    expect(talkStatusOf({ model: "gemini-3.8-live" })).toBeNull();
    expect(talkStatusOf({})).toBeNull();
  });
});

describe("the voice's rate", () => {
  it("is what Fish bills: bytes of text, at the model's list price", () => {
    // A million bytes is about twelve hours of speech, so a thousand bytes of English is well under a cent.
    expect(bytesOf("hello")).toBe(5);
    expect(bytesOf("καλημέρα")).toBe(16);            // Greek is two bytes a letter in UTF-8
    expect(costOf(1_000_000, "s2.1-pro")).toBe(15);
    expect(costOf(1_000_000, DEFAULT_TALK_MODEL)).toBe(0);
    expect(costOf(0, "s2.1-pro")).toBe(0);
  });

  it("keeps the app's microphone frames inside the ear's own pace", () => {
    expect(MIC_FRAME).toBe(640);                     // 40 ms at 16 kHz
    expect(TALK_RATE.voice).toBe(24_000);            // the player's own rate
  });
});
