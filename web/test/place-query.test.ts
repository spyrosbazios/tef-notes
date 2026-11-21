import { describe, expect, it } from "bun:test";
import { answered } from "../src/lib/place-query";

const done = { isFetching: false, isPlaceholderData: false };

describe("answered", () => {
  it("is true once the query for exactly the typed words has come back", () => {
    expect(answered("café", "café", done)).toBe(true);
  });
  it("is false while the debounce has not asked for the typed words yet", () => {
    expect(answered("café ro", "café", done)).toBe(false);
  });
  it("is false while the previous query's list is kept on screen for the new one", () => {
    expect(answered("café ro", "café ro", { isFetching: true, isPlaceholderData: true })).toBe(false);
    expect(answered("café ro", "café ro", { isFetching: false, isPlaceholderData: true })).toBe(false);
  });
  it("is false while the query is fetching", () => {
    expect(answered("café", "café", { isFetching: true, isPlaceholderData: false })).toBe(false);
  });
  it("has nothing to wait for when the words are too short to ask", () => {
    expect(answered("a", "a", { isFetching: false, isPlaceholderData: true })).toBe(true);
    expect(answered("", "", done)).toBe(true);
  });
});
