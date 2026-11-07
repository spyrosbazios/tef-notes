// Reader view's answer read defensively (src/reader.ts).
import { describe, expect, it } from "bun:test";
import { articleOf, readerPath, readingMinutes } from "../src/reader";

describe("articleOf", () => {
  it("takes an article, fields it lacks blank, an http image dropped", () => {
    expect(articleOf({ url: "https://a.org/x", markdown: " Hi ", title: "T", image: "http://a.org/i.jpg", words: 12.4, published: "2026-01-02T00:00" }))
      .toEqual({ url: "https://a.org/x", title: "T", author: "", site: "", published: "2026-01-02", image: "", markdown: "Hi", words: 12 });
  });
  it("none without a body or a web address", () => {
    expect(articleOf({ url: "https://a.org/", markdown: "  " })).toBeNull();
    expect(articleOf({ url: "file:///x", markdown: "Hi" })).toBeNull();
    expect(articleOf("nope")).toBeNull();
  });
});

it("readerPath, readingMinutes", () => {
  expect(readerPath("https://a.org/?q=1&b")).toBe("reader?url=https%3A%2F%2Fa.org%2F%3Fq%3D1%26b");
  expect(readingMinutes(0)).toBe(1);
  expect(readingMinutes(2300)).toBe(10);
});
