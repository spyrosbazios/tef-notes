import { describe, expect, it } from "bun:test";
import { decode, linkify, noteLinkPath, titleFromHtml, youtubeVideo } from "../src/links";

describe("titleFromHtml", () => {
  it("prefers og:title, whichever order the attributes come in", () => {
    expect(titleFromHtml(`<title>Site</title><meta content="Jito &amp; tips" property="og:title">`)).toBe("Jito & tips");
    expect(titleFromHtml(`<meta property='og:title' content='A "quoted" title'/>`)).toBe('A "quoted" title');
  });
  it("falls back to <title>, squashing whitespace", () => {
    expect(titleFromHtml("<head><title>\n  PumpSwap\n docs </title></head>")).toBe("PumpSwap docs");
    expect(titleFromHtml("<p>no head</p>")).toBeNull();
  });
  it("decodes numeric entities", () => expect(decode("it&#39;s &#x2014; ok &mdash; &bogus;")).toBe("it's — ok — &bogus;"));
});

describe("linkify", () => {
  it("wraps the URL with escaped text", () => {
    const e = linkify("read https://a.io/x later", "https://a.io/x", " Docs [v2] ");
    expect(e).toBe("read [Docs \\[v2\\]](https://a.io/x) later");
  });
  it("takes $ in a title literally", () => {
    expect(linkify("x https://a.io y", "https://a.io", "Save $$ — $& $1 off")).toBe("x [Save $$ — $& $1 off](https://a.io) y");
  });
});

describe("noteLinkPath", () => {
  it("reads a note link however the laptop wrote it", () => {
    expect(noteLinkPath("20261001-foo.md")).toBe("notes/20261001-foo.md");
    expect(noteLinkPath("notes/foo.md")).toBe("notes/foo.md");
    expect(noteLinkPath("../notes/foo.md#later")).toBe("notes/foo.md");
    expect(noteLinkPath("./%CE%9B%CE%AF%CF%83%CF%84%CE%B1.md")).toBe("notes/Λίστα.md");
  });
  it("leaves anything with a scheme, or not a .md file, to the OS", () => {
    for (const u of ["https://github.com/o/r/blob/main/README.md", "mailto:a@b.co", "tel:123", "notes/", "notes/a.txt"]) expect(noteLinkPath(u), u).toBeNull();
  });
});

describe("youtubeVideo", () => {
  it("reads the id from every link shape", () => {
    for (const u of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ", "https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=x",
      "https://youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/live/dQw4w9WgXcQ?si=a", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"])
      expect(youtubeVideo(u)?.id).toBe("dQw4w9WgXcQ");
  });
  it("reads a start time", () => {
    expect(youtubeVideo("https://youtu.be/dQw4w9WgXcQ?t=90")?.start).toBe(90);
    expect(youtubeVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s")?.start).toBe(65);
    expect(youtubeVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ")?.start).toBe(0);
  });
  it("is null for anything that is not one video", () => {
    expect(youtubeVideo("https://www.youtube.com/@channel")).toBeNull();
    expect(youtubeVideo("https://www.youtube.com/playlist?list=PL1")).toBeNull();
    expect(youtubeVideo("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(youtubeVideo("not a url")).toBeNull();
  });
});
