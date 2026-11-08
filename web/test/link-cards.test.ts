// Which paragraphs get a link card: only a paragraph that is nothing but one URL.
import { describe, expect, test } from "bun:test";
import { cardUrl } from "../src/editor/link-cards";
import { summarised } from "../src/editor/link-tools";
import { parse } from "../src/editor/markdown";

const urls = (md: string) => {
  const out: (string | null)[] = [];
  parse(md).forEach((n) => out.push(cardUrl(n)));
  return out;
};

describe("cardUrl", () => {
  test("a URL alone on its line, however it was written", () => {
    expect(urls("https://example.com/a?b=1\n\n<https://example.org/x>\n\nhttp://example.net/")).toEqual([
      "https://example.com/a?b=1", "https://example.org/x", "http://example.net/",
    ]);
  });
  test("surrounding whitespace does not matter", () => {
    expect(urls("  https://example.com/a  \n")).toEqual(["https://example.com/a"]);
  });
  test("a labelled link that is the whole line: its address", () => {
    expect(urls("[a page](https://example.com/a)")).toEqual(["https://example.com/a"]);
  });
  test("prose, a link among words, a marked or coded URL do not", () => {
    expect(urls("see https://example.com/a\n\nsee [a page](https://example.com/a)\n\n[a **b**](https://example.com/a)\n\n**https://example.com/a**\n\n`https://example.com/a`\n\nhttps://a.com/x https://b.com/y")).toEqual([null, null, null, null, null, null]);
  });
  test("only at the top: a URL in a list or quote stays a link", () => {
    expect(urls("- https://example.com/a\n\n> https://example.com/b")).toEqual([null, null]);
  });
  test("a heading or a break in the paragraph is not one", () => {
    expect(urls("# https://example.com/a\n\nhttps://example.com/a\nhttps://example.com/b")).toEqual([null, null]);
  });
  test("other schemes are not", () => {
    expect(urls("ftp://example.com/a\n\nmailto:a@b.co")).toEqual([null, null]);
  });
  test("a PDF attached to the note is a chip, not a card", () => {
    expect(urls("https://example.com/attachments/20261005-a/doc.pdf\n\n<https://example.com/attachments/20261005-a/doc.pdf>\n\n[https://example.com/a](../attachments/20261005-a/doc.pdf)")).toEqual([null, null, null]);
  });
});

describe("summarised", () => {
  const after = (md: string) => { const d = parse(md); return summarised(d, d.firstChild!.nodeSize); };
  test("a summary quote under the link, its first line Summary and a list after it", () => {
    expect(after("[a page](https://example.com/a)\n\n> **Summary**\n>\n> - one\n> - two")).toBe(true);
  });
  test("any other quote, or none, is not", () => {
    expect(after("[a page](https://example.com/a)\n\n> Summaryish words")).toBe(false);
    expect(after("[a page](https://example.com/a)\n\nSummary")).toBe(false);
  });
});
