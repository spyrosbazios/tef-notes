// Which links get a Reader view button in the editor: every http(s) link in a note's prose, one per link, except a
// paragraph that is only a URL (its card carries the button).
import { describe, expect, test } from "bun:test";
import { readableLink, readableRuns } from "../src/editor/link-read";
import { parse } from "../src/editor/markdown";

const runs = (md: string) => readableRuns(parse(md)).map((r) => r.href);

describe("readableRuns", () => {
  test("one per link, however many a note holds", () => {
    expect(runs("see [a](https://a.com/x) and [b](https://b.com/y)")).toEqual(["https://a.com/x", "https://b.com/y"]);
  });
  test("a link split by a mark is still one run", () => {
    expect(runs("[a **b** c](https://a.com/x)")).toEqual(["https://a.com/x"]);
  });
  test("a paragraph that is only a URL is the card's, not the button's", () => {
    expect(runs("https://a.com/x\n\nsee [b](https://b.com/y)")).toEqual(["https://b.com/y"]);
  });
  test("a note link and an attached file are not read", () => {
    expect(runs("[n](20261001-foo.md)\n\n[p](../attachments/20261001-a/doc.pdf)\n\n[d](../attachments/20261001-a/sketch.excalidraw)")).toEqual([]);
  });
  test("a link in a heading or a list is read", () => {
    expect(runs("# [a](https://a.com/x)\n\n- [b](https://b.com/y)")).toEqual(["https://a.com/x", "https://b.com/y"]);
  });
});

describe("readableLink", () => {
  test("only http(s)", () => {
    expect(["https://a.com/x", "http://a.com/x", "mailto:a@b.co", "20261001-foo.md", "../attachments/20261001-a/doc.pdf", "ftp://a.com/x"].map(readableLink))
      .toEqual([true, true, false, false, false, false]);
  });
});
