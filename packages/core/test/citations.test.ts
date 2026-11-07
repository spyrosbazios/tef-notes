// The sources a turn read and the citations in an answer (packages/core/src/citations.ts): what the web app's chips and
// the phone's source list are built from.
import { describe, expect, it } from "bun:test";
import { citeLink, citedIn, findCite, hostOf, matchesSource, sourcesOf } from "../src/citations";

const NOTE = "---\ntitle: Garage codes\ncreated: 2026-10-05\n---\nThe side door is 4821.\n";
const part = (type: string, input: unknown, output: unknown) => ({ type: `tool-${type}`, state: "output-available", input, output });

describe("sourcesOf", () => {
  it("reads a note, a search, a page and a web result, in order, deduped", () => {
    const parts = [
      part("read_note", { path: "notes/garage.md" }, { path: "notes/garage.md", text: NOTE }),
      part("search_notes", { query: "wifi" }, { results: [{ path: "notes/wifi.md", title: "Wi-Fi", snippet: "router is under the stairs", match: "words" }] }),
      part("read_page", { url: "https://Example.com/a/" }, { url: "https://Example.com/a/", title: "How it works", site: "Example", text: "The unit ships in May." }),
      part("web_search", { query: "x" }, { results: [{ title: "Spec", url: "https://specs.example.org/p", excerpts: ["Rated 20 W."] }] }),
      part("search_notes", { query: "garage" }, { results: [{ path: "notes/garage.md", title: "Garage codes", snippet: "dup", match: "both" }] }),
    ];
    const s = sourcesOf(parts);
    expect(s.map((x) => x.kind)).toEqual(["note", "note", "page", "page"]);
    expect(s[0]).toMatchObject({ kind: "note", href: "notes/garage.md", title: "Garage codes", site: "Note", snippet: "The side door is 4821." });
    expect(s[1]).toMatchObject({ path: "notes/wifi.md", title: "Wi-Fi", snippet: "router is under the stairs" });
    expect(s[2]).toMatchObject({ kind: "page", href: "https://Example.com/a/", site: "example.com", snippet: "The unit ships in May." });
    expect(s[3]).toMatchObject({ url: "https://specs.example.org/p", title: "Spec", snippet: "Rated 20 W." });
  });

  it("reads a tool the client doesn't know, as the SDK's `dynamic-tool`", () => {
    const s = sourcesOf([{ type: "dynamic-tool", toolName: "read_note", state: "output-available", input: { path: "notes/garage.md" }, output: { path: "notes/garage.md", text: NOTE } }]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: "note", title: "Garage codes" });
  });

  it("matches a page the model linked by the URL it was fetched with, after a redirect", () => {
    const s = sourcesOf([part("read_page", { url: "http://short.test/x" }, { url: "https://real.test/article", title: "Article", site: "real.test", text: "Hello." })]);
    expect(s[0].also).toEqual(["http://short.test/x"]);
    expect(citedIn("[the article](http://short.test/x)", s).map((c) => c.href)).toEqual(["https://real.test/article"]);
  });

  it("takes a note's title from its file and a PDF's from its name", () => {
    const s = sourcesOf([part("read_attachment", { path: "notes/boiler.md", name: "manual.pdf" }, { name: "manual.pdf", pages: 40, from: 1, to: 3, text: "Pressure should read 1.5 bar." })]);
    expect(s).toEqual([{ kind: "pdf", href: "manual.pdf", path: "notes/boiler.md", title: "manual.pdf", site: "PDF", snippet: "Pressure should read 1.5 bar." }]);
  });

  it("leaves out memory, errors, writes and unfinished calls", () => {
    const parts = [
      part("read_note", { path: "agent/memory.md" }, { path: "agent/memory.md", text: "I prefer Greek." }),
      part("read_note", { path: "notes/gone.md" }, { error: "not found" }),
      part("create_note", { title: "x" }, { saved: "notes/x.md", card: {} }),
      { type: "tool-read_page", state: "input-available", input: { url: "https://a.example" } },
    ];
    expect(sourcesOf(parts)).toEqual([]);
  });
});

describe("citedIn", () => {
  const sources = sourcesOf([
    part("read_note", { path: "notes/garage.md" }, { path: "notes/garage.md", text: NOTE }),
    part("web_search", { query: "x" }, { results: [{ title: "Specs", url: "https://www.example.com/specs/", excerpts: ["Rated 20 W."] }] }),
    part("read_page", { url: "https://blog.test/post" }, { url: "https://blog.test/post", title: "Post", site: "blog.test", text: "It shipped." }),
  ]);

  it("numbers sources by first citation and counts each once", () => {
    const answer = "The side door is [Garage codes](notes/garage.md). It is [rated 20 W](https://example.com/specs#power) and again [the same](https://www.example.com/specs/).";
    expect(citedIn(answer, sources).map((c) => [c.n, c.href])).toEqual([[1, "notes/garage.md"], [2, "https://www.example.com/specs/"]]);
  });

  it("ignores an unmatched link, an image and a link to a source not read", () => {
    const answer = "See [elsewhere](https://nowhere.test/), ![shot](notes/garage.md) and [a page](https://blog.test/post).";
    expect(citedIn(answer, sources).map((c) => c.href)).toEqual(["https://blog.test/post"]);
  });

  it("nothing to cite when the answer names no source", () => {
    expect(citedIn("Just a line.", sources)).toEqual([]);
  });
});

describe("matching and opening", () => {
  const sources = sourcesOf([part("read_note", { path: "notes/a.md" }, { path: "notes/a.md", text: "---\ntitle: A\ncreated: 2026-01-01\n---\nhi\n" })]);

  it("matches a note by path and a page by host, case and trailing slash", () => {
    const note = sources[0];
    expect(matchesSource("notes/a.md", note)).toBe(true);
    expect(matchesSource("./notes/a.md", note)).toBe(true);
    expect(matchesSource("notes/b.md", note)).toBe(false);
    const page = { kind: "page" as const, href: "https://Example.com/x", title: "x", site: "example.com", url: "https://Example.com/x" };
    expect(matchesSource("https://www.example.com/x/", page)).toBe(true);
    expect(matchesSource("https://example.com/x#top", page)).toBe(true);
    expect(matchesSource("https://example.com/y", page)).toBe(false);
  });

  it("finds the citation a link points at, and where it opens", () => {
    const [c] = citedIn("[A](notes/a.md)", sources);
    expect(findCite("notes/a.md", [c])?.n).toBe(1);
    expect(findCite("notes/other.md", [c])).toBeUndefined();
    expect(citeLink(c)).toBe("/note/a");
    expect(hostOf("https://www.example.com/x")).toBe("example.com");
  });
});
