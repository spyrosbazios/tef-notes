// The reader (src/reader.ts): an article out of a page's HTML, as markdown, and none out of a page with nothing in it.
import { describe, expect, it } from "bun:test";
import { parse } from "../src/reader";

const PAGE = `<!doctype html><html><head><title>Ink and paper | The Desk</title>
<meta property="og:site_name" content="The Desk"><meta name="author" content="A. Writer">
<meta property="og:image" content="https://example.com/cover.jpg"></head><body>
<nav><a href="/">Home</a><a href="/about">About</a></nav>
<article><h1>Ink and paper</h1>
${Array.from({ length: 8 }, (_, i) => `<p>Paragraph ${i} about why a notebook kept by hand is still worth the trouble, with <strong>some</strong> words.</p>`).join("")}
</article><footer>Subscribe to our newsletter</footer></body></html>`;

describe("parse", () => {
  it("keeps the article as markdown and drops the clutter", async () => {
    const a = await parse(PAGE, "https://example.com/ink");
    expect(a?.title).toBe("Ink and paper");
    expect(a?.site).toBe("The Desk");
    expect(a?.image).toBe("https://example.com/cover.jpg");
    expect(a?.markdown).toContain("Paragraph 3 about why");
    expect(a?.markdown).toContain("**some**");
    expect(a?.markdown).not.toContain("Subscribe");
    expect(a?.words).toBeGreaterThan(50);
  });
  it("none for an empty page", async () => {
    expect(await parse("<html><body></body></html>", "https://example.com/")).toBeNull();
  });
});
