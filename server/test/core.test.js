// lib/core.js, the hooks' bundle of the clients' code (pb_hooks/bundle/core.ts): it is the clients' code, so these check
// only what the bundling could break. PocketBase running it is server/integration's (the clip and tag routes there).
import { describe, expect, test } from "bun:test";
import core from "../pb_hooks/lib/core.js";

describe("the hooks' bundle", () => {
  test("folds every script's combining marks away, as the clients compare tag names", () => {
    // Hebrew points, Devanagari vowel signs, Arabic harakat, Japanese dakuten, Thai tone marks, Vietnamese tones
    expect(core.fold("שָׁלוֹם")).toBe("שלום");
    expect(core.fold("مَرْحَبًا")).toBe("مرحبا");
    expect(core.fold("が")).toBe(core.fold("か"));
    expect(core.fold("ก่อน")).toBe("กอน");
    expect(core.fold("Việt Nam")).toBe("viet nam");
    expect(core.fold("ΈΡΓΟ")).toBe("εργο");
  });
  test("a clip of a bare link is titled by its site: the bundle's URL", () => {
    const s = { text: "", url: "https://user@WWW.Example.org:8080/x", images: [], pdfs: [], title: null };
    expect(core.titleFor(s, null)).toBe("example.org");
  });
  test("a note written and read back", () => {
    const text = core.serializeNote({ title: "Κωδικοί: \"a\"", created: "2026-10-05", tags: ["a, b", "yes"] }, "Body.\n");
    const n = core.parseNote(core.newNotePath("Κωδικοί γκαράζ", Date.parse("2026-10-05T12:00:00")), text);
    expect(n).toMatchObject({ id: "20261005-kodikoi-gkaraz", title: "Κωδικοί: \"a\"", tags: ["a, b", "yes"], body: "Body.\n" });
    expect(core.noteColumns("notes/x.md", core.withFlags("notes/x.md", text, { tags: ["z"] })).tags).toEqual(["z"]);
  });
});
