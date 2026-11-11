import { describe, expect, it } from "bun:test";
import { aboutNotes, askedAbout, editNote, exportPlan, fileNameOf, importPlan } from "../src/handoff";

describe("aboutNotes", () => {
  it("names one note by title and path and leaves the line open", () => {
    expect(aboutNotes([{ path: "notes/20261005-garage.md", title: "Garage door codes" }])).toBe("About my note “Garage door codes” (notes/20261005-garage.md): ");
  });
  it("lists several, one a line, and leaves a blank line for the question", () => {
    const t = aboutNotes([{ path: "notes/a.md", title: "A" }, { path: "notes/b.md", title: " " }]);
    expect(t).toBe("About these notes:\n- “A” (notes/a.md)\n- “b” (notes/b.md)\n\n");
  });
});

describe("editNote", () => {
  it("names the note by title and path, then the owner's words", () => {
    expect(editNote({ path: "notes/20261005-garage.md", title: "Garage door codes" }, "  add the garage code 1234 "))
      .toBe("Edit my note “Garage door codes” (notes/20261005-garage.md), changing only what I ask: add the garage code 1234");
  });
  it("falls back to the file's id for an untitled note", () => {
    expect(editNote({ path: "notes/20261005-garage.md", title: " " }, "fix the typos")).toContain("“20261005-garage” (notes/20261005-garage.md)");
  });
});

describe("exportPlan", () => {
  const photo = (note: string, name: string) => ({ rec: `r-${name}`, note, name, file: `${name}_x` });
  it("keeps the attachments a body links, under attachments/<note-id>/", () => {
    const text = "---\ntitle: T\ncreated: 2026-10-05\n---\n![](../attachments/n1/a.jpg)\n[doc.pdf](../attachments/n1/doc.pdf)\n![](../attachments/n1/a.jpg)\n";
    const [e] = exportPlan([{ path: "notes/n1.md", text }], [photo("n1", "a.jpg"), photo("n1", "doc.pdf"), photo("n1", "orphan.jpg"), photo("n2", "a.jpg")]);
    expect(e.files.map((f) => f.path)).toEqual(["attachments/n1/a.jpg", "attachments/n1/doc.pdf"]);
    expect(e.text).toBe(text);
  });
  it("names a file by its path's basename", () => {
    expect(fileNameOf("notes/20261005-garage.md")).toBe("20261005-garage.md");
  });
});

describe("importPlan", () => {
  it("takes an export back unchanged", () => {
    const text = "---\ntitle: T\ncreated: 2026-10-05\n---\n![](../attachments/20261005-t/a.jpg)\n[doc](../attachments/20261005-t/doc.pdf)\n";
    const [e] = importPlan([{ from: "notes/20261005-t.md", text }], new Set(["notes/20261005-t.md", "attachments/20261005-t/a.jpg", "attachments/20261005-t/doc.pdf"]), "2026-11-05");
    expect(e).toEqual({ from: "notes/20261005-t.md", path: "notes/20261005-t.md", text, files: [
      { from: "attachments/20261005-t/a.jpg", name: "a.jpg" }, { from: "attachments/20261005-t/doc.pdf", name: "doc.pdf" }] });
  });
  it("names a plain file by its slug, gives it frontmatter and moves its files under it", () => {
    const files = new Set(["Trips/Πάρος 2025.md", "Trips/img/one.png", "img/one.png", "x.md"]);
    const [e] = importPlan([{ from: "Trips/Πάρος 2025.md", text: "# Paros\n![](img/one.png) ![](../img/one.png) ![](<img/one.png>)\n[x](../x.md) ![](missing.png) [w](https://a.b/c.png)\n" }], files, "2026-11-05");
    expect(e.path).toBe("notes/paros-2025.md");
    expect(e.files).toEqual([{ from: "Trips/img/one.png", name: "one.png" }, { from: "img/one.png", name: "one-2.png" }]);
    expect(e.text).toBe("---\ntitle: Paros\ncreated: 2026-11-05\n---\n# Paros\n![](../attachments/paros-2025/one.png) ![](../attachments/paros-2025/one-2.png) ![](../attachments/paros-2025/one.png)\n[x](../x.md) ![](missing.png) [w](https://a.b/c.png)\n");
  });
  it("keeps ids apart, skips attachments/ and never climbs out of the folder", () => {
    const plan = importPlan([{ from: "a/note.md", text: "![](../../etc/p.png)" }, { from: "b/note.md", text: "x" }, { from: "attachments/n/r.md", text: "" }], new Set(["p.png"]), "2026-11-05");
    expect(plan.map((e) => e.path)).toEqual(["notes/note.md", "notes/note-2.md"]);
    expect(plan[0].files).toEqual([]);
  });
});

describe("askedAbout", () => {
  it("reads back one note and the question", () => {
    const text = aboutNotes([{ path: "notes/a.md", title: "A “quoted” title" }]) + "what is in it?";
    expect(askedAbout(text)).toEqual({ notes: [{ path: "notes/a.md", title: "A “quoted” title" }], rest: "what is in it?" });
  });
  it("reads back several notes", () => {
    const notes = [{ path: "notes/a.md", title: "A" }, { path: "notes/b.md", title: "B" }];
    expect(askedAbout(aboutNotes(notes) + "compare")).toEqual({ notes, rest: "compare" });
  });
  it("leaves any other message alone", () => {
    expect(askedAbout("About my note, roughly")).toEqual({ notes: [], rest: "About my note, roughly" });
    expect(aboutNotes([])).toBe("");
  });
});
