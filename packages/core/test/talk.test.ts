import { describe, expect, it } from "bun:test";
import { talkClientEventOf, talkServerEventOf, talkStatusOf } from "../src/talk";

describe("talkClientEventOf", () => {
  it("reads a start, with the context only when it has a view", () => {
    expect(talkClientEventOf(JSON.stringify({ type: "start", chat: "c1", writesWithoutAsking: true, context: { view: { kind: "home" } } })))
      .toEqual({ type: "start", chat: "c1", context: { view: { kind: "home" } }, writesWithoutAsking: true });
    expect(talkClientEventOf({ type: "start", chat: "c1", context: { note: {} } })).toEqual({ type: "start", chat: "c1", writesWithoutAsking: false });
  });

  it("asks only when told plainly not to: anything but true is false", () => {
    expect(talkClientEventOf({ type: "start", chat: "c1", writesWithoutAsking: "true" })).toEqual({ type: "start", chat: "c1", writesWithoutAsking: false });
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
    expect(talkServerEventOf({ type: "part", message: "m1", role: "assistant", index: 0, part: { type: "text", text: "Hi" } }))
      .toEqual({ type: "part", message: "m1", role: "assistant", index: 0, part: { type: "text", text: "Hi" } });
    expect(talkServerEventOf({ type: "usage", input: 120, output: 40, cost: 0.002 })).toEqual({ type: "usage", input: 120, output: 40, cost: 0.002 });
    expect(talkServerEventOf({ type: "error", message: "The speech model hung up" })).toEqual({ type: "error", message: "The speech model hung up" });
  });

  it("refuses a part it could not place, and counts nothing for a number that is not one", () => {
    for (const bad of [{ type: "part", message: "m1", role: "system", index: 0, part: { type: "text" } }, { type: "part", message: "m1", role: "user", index: -1, part: { type: "text" } }, { type: "part", message: "m1", role: "user", index: 0, part: {} }, { type: "start", chat: "c1" }])
      expect(talkServerEventOf(bad)).toBeNull();
    expect(talkServerEventOf({ type: "usage", input: "many", output: -1 })).toEqual({ type: "usage", input: 0, output: 0, cost: 0 });
  });
});

describe("talkStatusOf", () => {
  it("is the model, or nothing", () => {
    expect(talkStatusOf({ model: "some-live-model" })).toEqual({ model: "some-live-model" });
    expect(talkStatusOf({})).toBeNull();
  });
});
