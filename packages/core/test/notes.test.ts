import { describe, expect, it } from "bun:test";
import {
  appendToNote, appended, attachmentOf, isNotePath, matchQuery, merge3, mergeDraft, newNotePath, noteIdOf, parseNote, reconcile, rewriteImagePaths, serializeNote,
  picturesOf, mosaicCells, slugify, plainText, snippetOf, snippetParts, withFlags, HIT,
} from "../src/notes";
import { localDay } from "../src/time";

const P = "notes/20261005-garage-door-codes.md";
const DOC = "---\ntitle: Garage door codes\ncreated: 2026-10-05\npinned: false\ncolor: yellow\ntags: [home]\n---\nBody in GitHub-flavored markdown.\n";

describe("parseNote", () => {
  it("reads the root CLAUDE.md example", () => {
    expect(parseNote(P, DOC)).toEqual({
      id: "20261005-garage-door-codes", title: "Garage door codes", created: "2026-10-05", pinned: false, archived: false, color: "yellow",
      tags: ["home"], body: "Body in GitHub-flavored markdown.\n",
    });
  });

  it("titles a file with no frontmatter by its first heading, else its slug; created from the filename", () => {
    expect(parseNote(P, "intro\n\n# Codes\n\n## Not this\n")).toMatchObject({ title: "Codes", created: "2026-10-05", tags: [], pinned: false, body: "intro\n\n# Codes\n\n## Not this\n" });
    expect(parseNote(P, "just text\n").title).toBe("Garage door codes");
    expect(parseNote("notes/scratch.md", "").title).toBe("Scratch");
    expect(parseNote(P, "---\ncreated: 2026-01-02\n---\n# From the heading\n")).toMatchObject({ title: "From the heading", created: "2026-01-02" });
  });

  it("takes an unclosed --- as body", () => {
    expect(parseNote(P, "---\ntitle: x\nno end")).toMatchObject({ title: "Garage door codes", body: "---\ntitle: x\nno end" });
  });

  it("reads quoted strings, comments, block lists and odd colours", () => {
    const md = `---\ntitle: "Say \\"hi\\": now" # greeting\ncreated: '2026-10-05'\ncolor: Magenta\ntags:\n  - home\n  - "a, b"\n---\nx`;
    expect(parseNote(P, md)).toMatchObject({ title: 'Say "hi": now', created: "2026-10-05", tags: ["home", "a, b"], body: "x" });
    expect(parseNote(P, md).color).toBeUndefined();
    expect(parseNote(P, "---\ntitle: It''s\ntags: ['it''s', \"x\\\"y\", plain]\npinned: yes\n---\n")).toMatchObject({ title: "It''s", tags: ["it's", 'x"y', "plain"], pinned: true });
    expect(parseNote(P, "---\r\ntitle: CRLF\r\ntags: solo\r\n---\r\nbody\r\n")).toMatchObject({ title: "CRLF", tags: ["solo"], body: "body\r\n" });
  });
});

describe("serializeNote", () => {
  it("writes title and created always, the flags only when set, in order", () => {
    expect(serializeNote({ title: "Garage door codes", created: "2026-10-05", color: "yellow", tags: ["home"], pinned: true }, "Body\n"))
      .toBe("---\ntitle: Garage door codes\ncreated: 2026-10-05\npinned: true\ncolor: yellow\ntags: [home]\n---\nBody\n");
    expect(serializeNote({ title: "x", created: "2026-10-05", tags: [] }, "")).toBe("---\ntitle: x\ncreated: 2026-10-05\n---\n");
  });

  it("round-trips byte for byte, Greek, quotes and all", () => {
    const metas = [
      { title: "Κωδικοί γκαράζ — «πόρτα»", created: "2026-10-05", pinned: true, tags: ["σπίτι", "κλειδιά"] },
      { title: 'He said "hi": ok', created: "2026-10-05", color: "pink" as const },
      { title: "#1 priority", created: "2026-10-05", tags: ["a, b", "[x]", "it's", "true", "2026"] },
      { title: "true", created: "2026-10-05", pinned: true },
      { title: "2026", created: "2026-10-05" },
      { title: "Issue #5 - ok:", created: "2026-10-05" },
      { title: "back\\slash 'single' and tab\there", created: "2026-10-05" },
    ];
    for (const m of metas) {
      for (const body of ["", "Σώμα\n\n- [ ] x\n", "---\nnot frontmatter\n---\n", "no newline"]) {
        const md = serializeNote(m, body), n = parseNote(P, md);
        expect(n.body).toBe(body);
        expect(n.title).toBe(m.title);
        expect(n.tags).toEqual(m.tags ?? []);
        expect(serializeNote(n, n.body)).toBe(md);
      }
    }
  });

  it("an empty title reads as the heading or slug, as with no frontmatter", () => {
    expect(parseNote(P, serializeNote({ title: "", created: "2026-10-05" }, "# Typed later\n")).title).toBe("Typed later");
  });
});

describe("withFlags", () => {
  const md = serializeNote({ title: "T", created: "2026-10-05" }, "body\n");

  it("comes out as serializeNote would write it", () => {
    const on = withFlags(P, md, { pinned: true, color: "blue", tags: ["a"] });
    expect(on).toBe(serializeNote({ title: "T", created: "2026-10-05", pinned: true, color: "blue", tags: ["a"] }, "body\n"));
    expect(withFlags(P, on, { pinned: false, color: null, tags: [] })).toBe(md);
    const shelved = withFlags(P, on, { archived: true, pinned: false });
    expect(shelved).toBe(serializeNote({ title: "T", created: "2026-10-05", archived: true, color: "blue", tags: ["a"] }, "body\n"));
    expect(shelved).toContain("archived: true\ncolor: blue");
    expect(parseNote(P, shelved)).toMatchObject({ archived: true, pinned: false });
    expect(withFlags(P, shelved, { archived: false, color: null, tags: [] })).toBe(md);
    expect(withFlags(P, on, { color: "green" })).toBe(serializeNote({ title: "T", created: "2026-10-05", pinned: true, color: "green", tags: ["a"] }, "body\n"));
  });

  it("keeps keys and quoting it doesn't know", () => {
    const laptop = "---\ntitle: 'T'\nsource: https://x.io\ncreated: 2026-10-05\ntags:\n  - old\n---\nbody\n";
    expect(withFlags(P, laptop, { tags: ["new"], pinned: true })).toBe("---\ntitle: 'T'\nsource: https://x.io\ncreated: 2026-10-05\npinned: true\ntags: [new]\n---\nbody\n");
  });

  it("adds frontmatter to a plain file, the body untouched", () => {
    expect(withFlags(P, "# Codes\n\n1234\n", { color: "yellow" })).toBe("---\ntitle: Codes\ncreated: 2026-10-05\ncolor: yellow\n---\n# Codes\n\n1234\n");
  });

  it("dates a plain file with no date in its name today, never `created: \"\"`", () => {
    expect(withFlags("notes/scratch.md", "x\n", { pinned: true })).toBe(`---\ntitle: Scratch\ncreated: ${localDay()}\npinned: true\n---\nx\n`);
  });
});

describe("paths", () => {
  const now = new Date(2026, 9, 5, 9, 30).getTime();

  it("names a note by date and slug", () => {
    expect(newNotePath("Garage door codes", now)).toBe(P);
    expect(newNotePath("Κωδικοί γκαράζ", now)).toBe("notes/20261005-kodikoi-gkaraz.md");
    expect(newNotePath("", now)).toBe("notes/20261005-note.md");
  });

  it("transliterates Greek: tonos, dialytika, final sigma, digraph letters", () => {
    expect(slugify("Ψυχή, θάλασσα & ΧΑΟΣ")).toBe("psychi-thalassa-chaos");
    expect(slugify("Ξέρω ϊ ΐ ΰ ώ")).toBe("xero-i-i-y-o");
    expect(slugify("Αβγδεζηικλμνοπρστυφω")).toBe("avgdeziiklmnoprstyfo");
    expect(slugify("Café déjà-vu — don't")).toBe("cafe-deja-vu-dont");
    expect(slugify("日本語")).toBe("note");
  });

  it("caps the slug at 40 without a trailing dash", () => {
    const s = slugify("a really long title that goes on and on well past forty characters");
    expect(s).toBe("a-really-long-title-that-goes-on-and-on");
    expect(s.length).toBeLessThanOrEqual(40);
  });

  it("uniquifies with -2, -3", () => {
    const taken = new Set([P, "notes/20261005-garage-door-codes-2.md"]);
    expect(newNotePath("Garage door codes", now, taken)).toBe("notes/20261005-garage-door-codes-3.md");
  });

  it("knows a note's path, id and attachments", () => {
    expect([P, "notes/sub/x.md", "agent/memory.md", "notes/x.txt"].filter(isNotePath)).toEqual([P]);
    expect(noteIdOf(P)).toBe("20261005-garage-door-codes");
    expect(attachmentOf("attachments/20261005-x/a.jpg")).toEqual({ noteId: "20261005-x", name: "a.jpg" });
    expect(attachmentOf("attachments/a.jpg")).toBeNull();
  });
});

describe("snippetOf", () => {
  it("skips headings, images, rules, code and blank lines; bullets and links read as text", () => {
    const body = "# Title\n\n![door](../attachments/x/a.jpg)\n\n---\n```\ncode()\n```\n- [ ] buy **milk**\n- see [the docs](https://x.io)\n> quoted\n";
    expect(snippetOf(body)).toBe("buy milk see the docs quoted");
  });

  it("reads escapes, autolinks, task boxes, empty items and emphasis as the text they show", () => {
    const body = "<https://example.com>\n- [x] check me\n- f\\[ m\n- \n-\n- pm]tn\\*\\*bo\\* tt\n1. *one* and ~~two~~ `three`\n";
    expect(snippetOf(body)).toBe("https://example.com check me f[ m pm]tn**bo* tt one and two three");
  });

  it("cuts at a word near 160", () => {
    const s = snippetOf(`${"word ".repeat(60)}\n`);
    expect(s.endsWith("…")).toBe(true);
    expect(s.length).toBeLessThanOrEqual(161);
    expect(snippetOf("")).toBe("");
  });
});

describe("plainText", () => {
  it("keeps headings and code but drops the syntax, for a search snippet", () => {
    expect(plainText("# Door\n```\ncode()\n```\n- [ ] [the \\] docs](https://x.io) ![a](b.jpg)\n\n> q\n---\n")).toBe("Door code() the ] docs q");
  });

  it("passes the match marks through", () => {
    expect(plainText(`- [x] **${HIT[0]}milk${HIT[1]}** and snake_case`)).toBe(`${HIT[0]}milk${HIT[1]} and snake_case`);
  });
});

describe("appendToNote", () => {
  it("adds a bullet at the end of the body, after a list or after a blank line", () => {
    expect(appendToNote("- a\n", "b")).toBe("- a\n- b\n");
    expect(appendToNote("intro", "b")).toBe("intro\n\n- b\n");
    expect(appendToNote("", "b")).toBe("- b\n");
    expect(appendToNote("- a\n\n\n", "  b  ")).toBe("- a\n- b\n\n\n");
  });

  it("adds a paragraph when the text spans lines", () => {
    expect(appendToNote("- a\n", "line one\nline two")).toBe("- a\n\nline one\nline two\n");
  });

  it("goes at the end of the named section, before the next one", () => {
    const md = "# T\n\n## Shopping\n\n- milk\n\n## Done\n\n- x\n";
    expect(appendToNote(md, "eggs", "Shopping")).toBe("# T\n\n## Shopping\n\n- milk\n- eggs\n\n## Done\n\n- x\n");
    expect(appendToNote(md, "y", "done")).toBe("# T\n\n## Shopping\n\n- milk\n\n## Done\n\n- x\n- y\n");
    expect(appendToNote("## Shopping\n## Done\n", "eggs", "Shopping")).toBe("## Shopping\n\n- eggs\n\n## Done\n");
    expect(appendToNote("## Shopping\n\n## Done\n", "eggs", "Shopping")).toBe("## Shopping\n\n- eggs\n\n## Done\n");
    expect(appendToNote("## Shopping\n\n### Sub\n- a\n# Next\n", "b", "Shopping")).toBe("## Shopping\n\n### Sub\n- a\n- b\n\n# Next\n");
  });

  it("adds a missing section at the end, and ignores headings in code", () => {
    expect(appendToNote("text\n", "eggs", "Shopping")).toBe("text\n\n## Shopping\n\n- eggs\n");
    expect(appendToNote("", "eggs", "## Shopping")).toBe("## Shopping\n\n- eggs\n");
    expect(appendToNote("```\n## Shopping\n```\n", "eggs", "Shopping")).toBe("```\n## Shopping\n```\n\n## Shopping\n\n- eggs\n");
  });

  it("leaves the user's text byte for byte", () => {
    const md = "  odd   spacing  \n## S\n\ttabbed\r\n\n## T\nx";
    const out = appendToNote(md, "new", "S");
    expect(out).toBe("  odd   spacing  \n## S\n\ttabbed\r\n\n- new\n\n## T\nx");
    expect(out.replace("\n- new\n", "")).toBe(md);
  });
});

describe("mergeDraft", () => {
  const start = "- milk\n\nnotes\n";

  it("keeps the draft when nothing moved under it", () => {
    expect(mergeDraft(start, "- milk\n- eggs\n\nnotes\n", start)).toEqual({ text: "- milk\n- eggs\n\nnotes\n", clash: false });
  });

  it("folds in what changed elsewhere meanwhile: a pull, an agent append", () => {
    expect(mergeDraft(start, "- milk\n- eggs\n\nnotes\n", "- milk\n\nnotes\n- bread\n"))
      .toEqual({ text: "- milk\n- eggs\n\nnotes\n- bread\n", clash: false });
  });

  it("keeps the draft as typed, and says so, when both changed the same lines", () => {
    expect(mergeDraft(start, "- oat milk\n\nnotes\n", "- soy milk\n\nnotes\n")).toEqual({ text: "- oat milk\n\nnotes\n", clash: true });
  });
});

describe("merge", () => {
  const base = "# t\n\na\nb\nc\n\nd\n";

  it("folds in edits to different lines", () => {
    expect(merge3(base, base.replace("a\n", "A\n"), base.replace("d\n", "d\ne\n"))).toBe("# t\n\nA\nb\nc\n\nd\ne\n");
    expect(merge3(base, base.replace("a\n", "A\n"), base.replace("b\n", "B\n"))).toBe("# t\n\nA\nB\nc\n\nd\n");
  });

  it("takes the same edit made on both sides once", () => {
    const both = base.replace("c\n", "C\n");
    expect(merge3(base, both, both.replace("d\n", "D\n"))).toBe("# t\n\na\nb\nC\n\nD\n");
  });

  it("gives up where both changed the same line, or added at the same spot", () => {
    expect(merge3(base, base.replace("b\n", "mine\n"), base.replace("b\n", "theirs\n"))).toBeNull();
    expect(merge3(base, base.replace("d\n", "d\nmine\n"), base.replace("d\n", "d\ntheirs\n"))).toBeNull();
    expect(merge3(base, base.replace("a\nb\nc\n", "x\n"), base.replace("b\n", "B\n"))).toBeNull();
  });
});

describe("reconcile", () => {
  const note = (flags: Parameters<typeof serializeNote>[0] extends infer M ? Partial<M> : never, body: string) =>
    serializeNote({ title: "T", created: "2026-10-05", ...flags }, body);
  const body = "one\n\ntwo\n\nthree\n";

  it("same text is no conflict, base or not", () => {
    expect(reconcile(undefined, note({}, body), note({}, body))).toBe(note({}, body));
  });

  it("only the flags differ: mine's flags win, base or not", () => {
    expect(reconcile(undefined, note({ pinned: true }, body), note({}, body))).toBe(note({ pinned: true }, body));
    expect(reconcile(undefined, note({}, body), note({ color: "pink" }, body))).toBe(note({}, body));
    expect(reconcile(note({}, body), note({ pinned: true }, body), note({ color: "blue" }, body))).toBe(note({ pinned: true }, body));
    expect(reconcile(note({ tags: ["a"] }, body), note({ tags: ["mine"] }, body), note({ tags: ["theirs"] }, body))).toBe(note({ tags: ["mine"] }, body));
  });

  it("colliding flags with body edits elsewhere: mine's flags, both bodies", () => {
    const base = note({}, body);
    const mine = note({ pinned: true }, body.replace("one", "ONE"));
    const theirs = note({ color: "green" }, body.replace("three", "THREE"));
    expect(reconcile(base, mine, theirs)).toBe(note({ pinned: true }, "ONE\n\ntwo\n\nTHREE\n"));
  });

  it("flags that don't collide merge like any line: a laptop pin survives a phone edit", () => {
    const base = note({}, body);
    expect(reconcile(base, note({}, body.replace("two", "TWO")), note({ pinned: true }, body))).toBe(note({ pinned: true }, body.replace("two", "TWO")));
  });

  it("is a conflict when both rewrote the same body line, and without a base when more than the flags differ", () => {
    expect(reconcile(note({}, body), note({}, body.replace("two", "mine")), note({}, body.replace("two", "theirs")))).toBeNull();
    expect(reconcile(undefined, note({ pinned: true }, "mine\n"), note({}, "theirs\n"))).toBeNull();
  });
});

describe("rewriteImagePaths", () => {
  const id = "20261005-garage", uri = (n: string) => (n === "missing.jpg" ? undefined : `file:///cache/${n}`);

  it("points this note's attachments at the cached copy", () => {
    expect(rewriteImagePaths(`![door](../attachments/${id}/a.jpg) and ![b](attachments/${id}/b%20c.jpg "t")`, id, uri))
      .toBe('![door](file:///cache/a.jpg) and ![b](file:///cache/b c.jpg "t")');
    expect(rewriteImagePaths(`<img src="/attachments/${id}/a.jpg">`, id, uri)).toBe('<img src="file:///cache/a.jpg">');
  });

  it("leaves what it can't resolve, other notes' and other sites' paths alone", () => {
    const md = `![x](../attachments/${id}/missing.jpg) ![y](../attachments/other/a.jpg) https://x.io/attachments/${id}/a.jpg ![z](../attachments/${id}x/a.jpg)`;
    expect(rewriteImagePaths(md, id, uri)).toBe(md);
  });
});

describe("search text", () => {
  it("quotes each word, the last one a prefix, folded", () => {
    expect(matchQuery("Πόρτα  γκαρ")).toBe('"πορτα" "γκαρ"*');
    expect(matchQuery('say "hi" OR -x')).toBe('"say" "hi" "or" "-x"*');
    expect(matchQuery("?? -- !")).toBeNull();
    expect(matchQuery("")).toBeNull();
  });

  it("splits a snippet at the marks", () => {
    expect(snippetParts(`…the ${HIT[0]}door${HIT[1]} code ${HIT[0]}1234${HIT[1]}`)).toEqual([
      { text: "…the ", hit: false }, { text: "door", hit: true }, { text: " code ", hit: false }, { text: "1234", hit: true },
    ]);
    expect(snippetParts("plain")).toEqual([{ text: "plain", hit: false }]);
  });
});

describe("picturesOf", () => {
  const id = "20261005-garage-door-codes";
  const att = (n: string) => `![](../attachments/${id}/${n})`;
  it("is the photos and PDFs in the body's order, before any link, each once", () => {
    expect(picturesOf(id, `See https://a.example.com\n\n${att("1.jpg")}\n[scan](../attachments/${id}/scan.pdf)\n${att("2.png")}\n${att("1.jpg")}`))
      .toEqual({ pictures: [{ image: "1.jpg" }, { pdf: "scan.pdf" }, { image: "2.png" }], more: 0 });
  });
  it("keeps the first four and counts the rest", () => {
    expect(picturesOf(id, [1, 2, 3, 4, 5, 6].map((i) => att(`${i}.jpg`)).join("\n")))
      .toEqual({ pictures: [1, 2, 3, 4].map((i) => ({ image: `${i}.jpg` })), more: 2 });
  });
  it("is the first link when there is no picture, a markdown link and a bare one alike", () => {
    expect(picturesOf(id, "Read [the docs](https://docs.example.com/a_(b)) then https://later.example.com.")).toEqual({ link: "https://docs.example.com/a_(b)" });
    expect(picturesOf(id, "nothing\nhttps://a.example.com/x.\nhttps://b.example.com")).toEqual({ link: "https://a.example.com/x" });
  });
  it("is a drawing as the picture kept beside it, marked so it is shown whole, once", () => {
    expect(picturesOf(id, `[Drawing](../attachments/${id}/plan.excalidraw)\n${att("1.jpg")}\n[again](../attachments/${id}/plan.excalidraw)`))
      .toEqual({ pictures: [{ image: "plan.png", drawing: true }, { image: "1.jpg" }], more: 0 });
  });
  it("ignores another note's files, and links in code", () => {
    expect(picturesOf(id, `![](../attachments/other-note/a.jpg)\n[scan](../attachments/other-note/scan.pdf)\n[d](../attachments/other-note/d.excalidraw)`)).toBeNull();
    expect(picturesOf(id, "```\ncurl https://a.example.com\n```\n~~~sh\nhttps://b.example.com\n~~~\nhttps://c.example.com")).toEqual({ link: "https://c.example.com" });
  });
  it("is null for a note with neither", () => expect(picturesOf(id, "just words\n\n- [ ] a task")).toBeNull());
});

describe("mosaicCells", () => {
  const area = (n: number) => mosaicCells(n).reduce((a, c) => a + c.w * c.h, 0);
  it("fills the whole area with one cell per picture, up to four", () => {
    expect([1, 2, 3, 4].map((n) => [mosaicCells(n).length, area(n)])).toEqual([[1, 1], [2, 1], [3, 1], [4, 1]]);
    expect(mosaicCells(9)).toHaveLength(4);
  });
  it("lays three as one tall and two stacked", () => {
    expect(mosaicCells(3)).toEqual([{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }]);
  });
});

describe("appended", () => {
  it("one line is one bullet, whether or not the agent wrote the marker", () => {
    expect(appended("- eggs\n", "milk")).toBe("- eggs\n- milk\n");
    expect(appended("- eggs\n", "- [ ] milk")).toBe("- eggs\n- [ ] milk\n");
    expect(appended("- eggs\n", "- one\n- two")).toBe("- eggs\n- one\n- two\n");
  });
});

