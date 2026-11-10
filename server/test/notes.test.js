// lib/notes.js, the server's copy of the note format: every file it writes must be the one the clients' core
// (packages/core/src/notes.ts, pocketbase.ts) writes, or the phone's 3-way merge sees a change that isn't one.
import { describe, expect, test } from "bun:test";
import lib from "../pb_hooks/lib/notes.js";
import { appendToNote, newNotePath, parseNote, serializeNote, slugify, withBody, withFlags } from "../../packages/core/src/notes";
import { noteColumns } from "../../packages/core/src/pocketbase";
import { linkPath, photoName } from "../../packages/core/src/photos";

const P = "notes/20261005-garage-door.md";
const NOTES = {
  plain: "---\ntitle: Garage door codes\ncreated: 2026-10-05\n---\nBody.",
  flags: "---\ntitle: Garage door codes\ncreated: 2026-10-05\npinned: true\ncolor: yellow\n---\nBody.",
  flow: "---\ntitle: Garage door codes\ncreated: 2026-10-05\ntags: [home, \"a, b\"]\n---\nBody.",
  block: "---\ntitle: Garage door codes\ncreated: 2026-10-05\ntags:\n  - home\n  - 'it''s'\ncolor: blue\n---\nBody.",
  single: "---\ntitle: Garage door codes\ncreated: 2026-10-05\ntags: home\n---\nBody.",
  extra: "---\ntitle: Garage door codes\nauthor: laptop\ncreated: 2026-10-05\nsource: web\n---\nBody.",
  crlf: "---\r\ntitle: Garage door codes\r\ncreated: 2026-10-05\r\n---\r\nBody.\r\n",
  bare: "# Garage door\nBody.",
  empty: "",
  unclosed: "---\ntitle: x\nBody.",
  scheduled: "---\ntitle: Shopping\ncreated: 2026-10-05\nwhen: 2026-11-03\nevening: true\ndue: 2026-11-04\nevery: 1w\nremind: \"09:00\"\n---\n- [ ] milk\n- [x] eggs\n- [ ] Call {id:k3f9}\n  - [x] sub\n",
  junk: "---\ntitle: Later\ncreated: 2026-10-05\nwhen: nope\ndone: 2026-10-30\nevery: often\n---\nBody.",
  tasks: "---\ntitle: Garage door codes\ncreated: 2026-10-05\n---\n- [ ] Call plumber {id:k3f9 when:2026-11-03 due:2026-11-10 every:1w}\n  - [ ] sub {id:s1}\n## Errands\n- [x] Renew passport {id:p2a1 done:2026-10-30}\n",
};
const LISTS = [["Food"], ["Food", "Home"], ["home", "Έργο", "yes", "7", "a: b", "x,y", "#t", "with \"quote\""], []];


describe("frontmatter", () => {
  test("parses as the core does", () => {
    for (const text of Object.values(NOTES)) {
      const { color, ...n } = parseNote(P, text), m = lib.parse(P, text);
      expect({ ...m, color: m.color ?? null }).toEqual({ ...n, color: color ?? null });
    }
  });
  test("the record's columns are the core's noteColumns", () => {
    for (const text of Object.values(NOTES)) expect(lib.columns(P, text)).toEqual(noteColumns(P, text));
  });
  for (const [name, text] of Object.entries(NOTES)) {
    test(`${name}: the tags line the core writes`, () => {
      for (const tags of LISTS) expect(lib.withTags(P, text, tags)).toBe(withFlags(P, text, { tags }));
    });
  }
  test("what it writes is read back", () => {
    for (const text of Object.values(NOTES)) for (const tags of LISTS) expect(lib.parse(P, lib.withTags(P, text, tags)).tags).toEqual(tags);
  });
  test("a new file is serializeNote's", () => {
    const metas = [
      { title: "Garage door codes", created: "2026-10-05" },
      { title: "yes", created: "2026-10-05", pinned: true, color: "pink", tags: ["a: b", "x,y"] },
      { title: "Τίτλος: με \"εισαγωγικά\"\nκαι γραμμή", created: "" },
      { title: "#hash", created: "not a date" },
      { title: "Here", created: "2026-10-05", tags: ["a"] },
    ];
    for (const m of metas) for (const body of ["", "Body.\n", "- [ ] one\n"]) expect(lib.serialize(m, body)).toBe(serializeNote(m, body));
  });
  test("a new body under the frontmatter as it was", () => {
    for (const text of Object.values(NOTES)) {
      const n = parseNote(P, text);
      expect(lib.withBody(text, lib.parse(P, text), "New.\n")).toBe(withBody(text, n, "New.\n"));
    }
  });
});

describe("ids", () => {
  const titles = ["Garage door codes", "Κωδικοί γκαράζ", "Ψάρια & Χταπόδι!", "Café crème — it’s ok", "   ", "x".repeat(80), "Ελληνικά ΚΕΦΑΛΑΙΑ ς", "2026: a year"];
  test("slugs as the core's", () => {
    for (const t of titles) expect(lib.slugify(t)).toBe(slugify(t));
  });
  test("paths as the core's, a taken one moved on", () => {
    const now = new Date(2026, 9, 5, 23, 59).getTime();
    for (const t of titles) expect(lib.newNotePath(t, now)).toBe(newNotePath(t, now));
    const taken = new Set(["notes/20261005-garage-door-codes.md", "notes/20261005-garage-door-codes-2.md"]);
    expect(lib.newNotePath("Garage door codes", now, taken)).toBe(newNotePath("Garage door codes", now, taken));
    expect(lib.newNotePath("Garage door codes", now, taken)).toBe("notes/20261005-garage-door-codes-3.md");
    expect(lib.localDay(now)).toBe("2026-10-05");
  });
});

describe("appending", () => {
  const bodies = ["", "\n", "Text.\n", "- one\n- two\n", "- one\n- two", "Para\n\n## Links\n\n- a\n\n## Other\n\nx\n", "```\n## Links\n```\n", "## Links\n"];
  const texts = ["one line", "- [ ] a task", "[Page](https://e.com)\n\nA line.\n\nclipped", "  spaced  "];
  test("the core's appendToNote, with a section and without", () => {
    for (const b of bodies) for (const t of texts) for (const s of [undefined, "Links", "## New one"]) expect(lib.appendToNote(b, t, s)).toBe(appendToNote(b, t, s));
  });
  test("append_to_note's: a line it marked a bullet keeps one marker", () => {
    expect(lib.appended("- a\n", "- b")).toBe("- a\n- b\n");
    expect(lib.appended("- a\n", "- [ ] b")).toBe("- a\n- [ ] b\n");
  });
});

describe("photos", () => {
  test("named and linked as photos.ts names and links them", () => {
    const at = Date.parse("2026-10-30T09:08:07");
    for (const taken of [new Set(), new Set(["20261030-090807.jpg"]), new Set(["20261030-090807.jpg", "20261030-090807-2.jpg"])]) {
      expect(lib.photoName(at, taken)).toBe(photoName(at, taken));
    }
    expect(lib.linkPath("20261030-a", "x.jpg")).toBe(linkPath("20261030-a", "x.jpg"));
    expect(lib.idOf("notes/20261030-a.md")).toBe("20261030-a");
  });
});
