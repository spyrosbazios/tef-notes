import { describe, expect, test } from "bun:test";
import { boxOf, keepBox, keepScroll, scrollKey, scrollOf } from "../src/lib/scroll-memory";

describe("scroll memory", () => {
  test("a list's place is its view and its lens", () => {
    expect(scrollKey("/", null)).toBe(scrollKey("/", undefined));
    expect(scrollKey("/", "a")).not.toBe(scrollKey("/", "b"));
    expect(scrollKey("/?tags=x", null)).not.toBe(scrollKey("/", null));
    expect(scrollKey("/today", null)).not.toBe(scrollKey("/inbox", null));
  });

  test("keeps where a list was left, rounded, and starts at the top", () => {
    const k = scrollKey("/memory-test", null);
    expect(scrollOf(k)).toBe(0);
    keepScroll(k, 1234.6);
    expect(scrollOf(k)).toBe(1235);
    keepScroll(k, 40);
    expect(scrollOf(k)).toBe(40);
  });

  test("back at the top is forgotten, and a stray negative is not kept", () => {
    const k = scrollKey("/memory-top", "lens");
    keepScroll(k, 500);
    keepScroll(k, 0);
    expect(scrollOf(k)).toBe(0);
    keepScroll(k, -20);
    expect(scrollOf(k)).toBe(0);
  });

  test("Home's task box comes back as it was left", () => {
    expect(boxOf()).toBeNull();          // never left: Home opens it on the owner's pick
    keepBox({ tab: "upcoming" });
    expect(boxOf()).toEqual({ tab: "upcoming" });
    keepBox({ tab: "today" });
  });
});
