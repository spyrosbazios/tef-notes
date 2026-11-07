import { describe, expect, it } from "bun:test";
import { attachmentsIn, imagesOf, readsAsMarkdown, resolveAttachments, withLineBreaks } from "../src/task-notes";

describe("imagesOf", () => {
  it("lists the image lines in order, remote and attached", () => {
    const md = "Look\n\n![a cat](https://cdn.example.com/c%20at.png)\n\ntext ![](../attachments/20261001-foo/20261001-101010.jpg) more\n[a link](https://x.y/z.png)";
    expect(imagesOf(md)).toEqual(["https://cdn.example.com/c%20at.png", "../attachments/20261001-foo/20261001-101010.jpg"]);
  });
  it("takes an angle-bracketed address and skips fenced code", () => {
    expect(imagesOf("![x](<https://a.b/c.jpg>)\n```\n![no](https://a.b/d.jpg)\n```\n![y](https://a.b/e.jpg \"t\")")).toEqual(["https://a.b/c.jpg", "https://a.b/e.jpg"]);
  });
  it("is empty without any", () => expect(imagesOf("[Picture](https://a.b/c.png)\nplain")).toEqual([]));
});

describe("attachmentsIn / resolveAttachments", () => {
  const md = "![](../attachments/n1/a%20b.jpg) ![](attachments/n2/c.jpg) ![](../attachments/n1/a%20b.jpg) ![r](https://h.example/attachments/n3/d.jpg)";
  it("finds each note's attachment once and ignores a remote path", () => {
    expect(attachmentsIn(md)).toEqual([{ noteId: "n1", name: "a b.jpg" }, { noteId: "n2", name: "c.jpg" }]);
  });
  it("points the ones it can at their copy and leaves the rest", () => {
    const out = resolveAttachments(md, (id, name) => (id === "n1" ? `file:///docs/${id}/${name}` : undefined));
    expect(out).toBe("![](file:///docs/n1/a b.jpg) ![](attachments/n2/c.jpg) ![](file:///docs/n1/a b.jpg) ![r](https://h.example/attachments/n3/d.jpg)");
  });
});


it("task notes with a link, a URL or emphasis read as markdown; plain text doesn't", () => {
  expect(readsAsMarkdown("Bank\n[Google Maps](https://maps.example/?q=1) · [coordinates](https://maps.example/?q=2)")).toBe(true);
  expect(readsAsMarkdown("see https://example.com")).toBe(true);
  expect(readsAsMarkdown("- milk\n- eggs")).toBe(true);
  expect(readsAsMarkdown("Mon–Fri 08:00–14:00 · take ID with you.")).toBe(false);
});

it("each typed line stays its own line; fences untouched", () => {
  expect(withLineBreaks("a\nb\n\nc")).toBe("a  \nb\n\nc");
  expect(withLineBreaks("```\nx\ny\n```")).toBe("```\nx\ny\n```");
});
