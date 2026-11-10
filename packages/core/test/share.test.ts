// A share from another app, shaped for a note or for the agent (src/share.ts).
import { describe, expect, it } from "bun:test";
import { askText, bodyFor, chatTitle, plainShared, titleFor, type Shared } from "../src/share";

const S = (p: Partial<Shared>): Shared => ({ text: "", url: null, images: [], pdfs: [], title: null, ...p });
const U = "https://example.com/a?b=1";

describe("a note of its own", () => {
  it("titles by the page, the first line, the site, or the day", () => {
    expect(titleFor(S({ url: U }), "Example Domain")).toBe("Example Domain");
    expect(titleFor(S({ text: "\n first line \nsecond" }), null)).toBe("first line");
    expect(titleFor(S({ text: "x".repeat(80) }), null)).toMatch(/^x{57}…$/);
    expect(titleFor(S({ url: "https://www.example.com/x" }), null)).toBe("example.com");
    expect(titleFor(S({ pdfs: [{ uri: "f", name: "Tax form.pdf" }] }), null)).toBe("Tax form");
    expect(titleFor(S({ images: [{ uri: "f", width: null, height: null }] }), null)).toMatch(/^Photos \d{4}-\d{2}-\d{2}$/);
  });

  it("links the URL where it sits in the text, else above it; bare when no title", () => {
    expect(bodyFor(S({ text: `Read ${U} now`, url: U }), "A [page]")).toBe(`Read [A \\[page\\]](${U}) now\n`);
    expect(bodyFor(S({ text: "a quote", url: U }), "Page")).toBe(`[Page](${U})\n\na quote\n`);
    expect(bodyFor(S({ url: U }), null)).toBe(`<${U}>\n`);
    expect(bodyFor(S({ images: [{ uri: "f", width: 1, height: 1 }] }), null)).toBe("");
  });
});

describe("for the agent", () => {
  it("wraps the parts in <shared>, title attribute escaped, the photos' note named", () => {
    const t = askText(S({ text: "a <b>", url: U, images: [{ uri: "f", width: 1, height: 1 }] }), 'Say "hi" & <go>', "notes/20261005-photos.md");
    expect(t).toBe(`<shared>\n<url title="Say &quot;hi&quot; &amp; &lt;go&gt;">${U}</url>\n<text>\na <b>\n</text>\n<files note="notes/20261005-photos.md" photos="1" pdfs="0" />\n</shared>\nFile this in my notes.`);
  });

  it("reads back plainly in the chat; other messages untouched", () => {
    expect(plainShared(askText(S({ text: "a quote", url: U, images: [{ uri: "f", width: 1, height: 1 }] }), "Page", "notes/p.md"))).toBe(`Shared:\nPage\n${U}\na quote\n1 photo`);
    expect(plainShared(askText(S({ pdfs: [{ uri: "f", name: "a.pdf" }, { uri: "g", name: "b.pdf" }], images: [{ uri: "f", width: 1, height: 1 }] }), null, "notes/p.md"))).toBe("Shared:\n1 photo, 2 PDFs");
    expect(plainShared("hello")).toBe("hello");
  });

  it("titles a chat by what was shared, a typed question as it is", () => {
    expect(chatTitle(askText(S({ url: U }), 'Speedrun & "Ethereum"'))).toBe('Shared: Speedrun & "Ethereum"');
    expect(chatTitle(askText(S({ url: "https://www.example.com/a/b" }), null))).toBe("Shared: example.com");
    expect(chatTitle(askText(S({ text: "a quote\nmore" }), null))).toBe("Shared: a quote");
    expect(chatTitle(askText(S({ images: [{ uri: "f", width: 1, height: 1 }] }), null, "notes/p.md"))).toBe("Shared: 1 photo");
    expect(chatTitle("what\n  is  this?")).toBe("what is this?");
  });
});
