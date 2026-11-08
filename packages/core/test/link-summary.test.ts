import { describe, expect, it } from "bun:test";
import { cardLines, lineUrl, withSummaries } from "../src/link-summary";

const block = "> **Summary**\n> A tool.";

describe("link summaries", () => {
  it("a card is a line that is only one link", () => {
    expect(lineUrl("[garak](https://github.com/NVIDIA/garak)")).toBe("https://github.com/NVIDIA/garak");
    expect(lineUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(lineUrl("- [garak](https://github.com/NVIDIA/garak)")).toBeNull();
    expect(lineUrl("[garak](https://x.com) — nmap for LLMs")).toBeNull();
    expect(lineUrl("  https://example.com")).toBeNull();
  });

  it("knows a card already summarised, and skips code fences", () => {
    const body = "[a](https://a.com)\n\n> **Summary**\n> old\n\n[b](https://b.com)\n```\nhttps://c.com\n```\n";
    expect(cardLines(body)).toEqual([
      { url: "https://a.com", at: 0, summarised: true },
      { url: "https://b.com", at: 5, summarised: false },
    ]);
  });

  it("puts the block under the card, a blank line either side", () => {
    const body = "## Tools\n\n[a](https://a.com)\nwhat it is\n\n[b](https://b.com)\n";
    const out = withSummaries(body, new Map([["https://a.com", block], ["https://b.com", block]]));
    expect(out).toBe(`## Tools\n\n[a](https://a.com)\n\n${block}\n\nwhat it is\n\n[b](https://b.com)\n\n${block}\n`);
    expect(cardLines(out).every((c) => c.summarised)).toBe(true);
    expect(withSummaries(out, new Map([["https://a.com", "> **Summary**\n> new"]]))).toBe(out);
  });
});
