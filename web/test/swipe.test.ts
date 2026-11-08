import { describe, expect, it } from "bun:test";
import { DELETE_AT, DELETE_WIDTH, FRICTION, offsetOf, outcomeOf, WHEN_AT, WHEN_WIDTH } from "../src/lib/swipe";

describe("offsetOf", () => {
  it("follows the finger at half speed", () => {
    expect(offsetOf(40, 0, true)).toBe(40 / FRICTION);
    expect(offsetOf(-60, 0, true)).toBe(-60 / FRICTION);
  });
  it("stops at the width of what it uncovers", () => {
    expect(offsetOf(1000, 0, true)).toBe(WHEN_WIDTH);
    expect(offsetOf(-1000, 0, true)).toBe(-DELETE_WIDTH);
  });
  it("lets a done row go left only", () => {
    expect(offsetOf(200, 0, false)).toBe(0);
    expect(offsetOf(-200, 0, false)).toBe(-DELETE_WIDTH);
  });
  it("carries on from Delete being out", () => {
    expect(offsetOf(0, -DELETE_WIDTH, true)).toBe(-DELETE_WIDTH);
    expect(offsetOf(DELETE_WIDTH * FRICTION, -DELETE_WIDTH, true)).toBe(0);
  });
});

describe("outcomeOf", () => {
  it("asks When past its threshold, and leaves Delete out past its own", () => {
    expect(outcomeOf(WHEN_AT)).toBe("when");
    expect(outcomeOf(WHEN_AT - 1)).toBe("closed");
    expect(outcomeOf(-DELETE_AT)).toBe("delete");
    expect(outcomeOf(-DELETE_AT + 1)).toBe("closed");
    expect(outcomeOf(0)).toBe("closed");
  });
});
