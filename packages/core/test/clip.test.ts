// The clip routes' shapes shared with the extension (src/clip.ts), a share as a clip, the picture JEV looks at.
import { describe, expect, it } from "bun:test";
import { recordId } from "../src/client/ids";
import { choices, describe as said, NEW, NEW_TASK, saveBodies, saveBody, sendsFiles, suggestBody, summaryNotice, targetOf, titled, type ClipResult, type Suggestions } from "../src/clip";
import { LOOK_MAX, LOOK_MIN, lookSize } from "../src/photos";
import { clipOf, type Shared } from "../src/share";

const S = (p: Partial<Shared>): Shared => ({ text: "", url: null, images: [], pdfs: [], title: null, ...p });
const U = "https://example.com/a";
const ID = "abc123def456ghi";

describe("a share as a clip", () => {
  it("a link, its page's title, the text as the selection, the photos and PDFs as its files", () => {
    expect(clipOf(S({ url: U }), "Page")).toEqual({ url: U, title: "Page" });
    expect(clipOf(S({ url: U, title: "From the app", text: "a quote" }), null)).toEqual({ url: U, title: "From the app", selection: "a quote" });
    expect(clipOf(S({ text: "just words" }), null)).toEqual({ url: "", title: "", selection: "just words" });
    expect(clipOf(S({ images: [{ uri: "file:///a.jpg", width: 1, height: 2 }] }), null)).toEqual({ url: "", title: "", images: [{ src: "" }] });
    const img = { uri: "file:///a.jpg", width: 1, height: 2 };
    expect(clipOf(S({ images: [img, img] }), null)).toEqual({ url: "", title: "", images: [{ src: "" }, { src: "" }] });
    expect(clipOf(S({ url: U, pdfs: [{ uri: "f", name: "a.pdf" }] }), null)).toEqual({ url: U, title: "", pdfs: [{ name: "a.pdf" }] });
  });
});

describe("the options", () => {
  const s: Suggestions = {
    suggestions: [
      { kind: "note", path: "notes/a.md", title: "A", p: 0.3 }, { kind: "task", id: ID, title: "Plan", p: 0.5 }, { kind: "note", path: "notes/b.md", title: "B", p: 0.1 },
    ],
    pick: { kind: "task", id: ID },
  };
  it("the pick first, the others in order, a new note last", () => {
    expect(choices(s, null)).toEqual([
      { target: { kind: "task", id: ID }, label: "Add to task Plan", hint: "50%" },
      { target: { kind: "note", path: "notes/a.md" }, label: "Append to A", hint: "30%" },
      { target: { kind: "note", path: "notes/b.md" }, label: "Append to B", hint: "10%" },
      { target: NEW, label: "New note" },
      { target: NEW_TASK, label: "New task" },
    ]);
  });
  it("a new note first when it is the pick or there is none; the hints say a task keeps no files", () => {
    expect(choices({ ...s, pick: NEW }, null).map((c) => c.target.kind)).toEqual(["new", "note", "task", "note", "newtask"]);
    expect(choices({ suggestions: [], pick: NEW }, null)).toEqual([{ target: NEW, label: "New note" }, { target: NEW_TASK, label: "New task" }]);
    expect(choices(s, "picture")[0].hint).toBe("50%, no picture");
    expect(choices(s, "PDFs").at(-1)).toEqual({ target: NEW_TASK, label: "New task", hint: "PDFs in a linked note" });
    expect(targetOf(s.suggestions[0])).toEqual({ kind: "note", path: "notes/a.md" });
  });
  it("what was done", () => {
    expect(said({ kind: "note", path: "notes/a.md", title: "A", action: "created" })).toBe("Created a new note");
    expect(said({ kind: "note", path: "notes/a.md", title: "A", action: "appended" })).toBe("Appended to a note");
    expect(said({ kind: "task", id: ID, title: "T", action: "appended" })).toBe("Added to a task");
    expect(said({ kind: "task", id: ID, title: "T", action: "created", note: "notes/a.md" })).toBe("Created a new task");
  });
  it("the owner's title goes on a new note or task only", () => {
    expect(titled(NEW, " Mine ")).toEqual({ kind: "new", title: "Mine" });
    expect(titled(NEW_TASK, "Mine")).toEqual({ kind: "newtask", title: "Mine" });
    expect(titled(NEW_TASK, "  ")).toBe(NEW_TASK);
    expect(titled({ kind: "task", id: ID }, "Mine")).toEqual({ kind: "task", id: ID });
  });
});

describe("the requests", () => {
  const page = { url: U, title: "Page", images: [{ src: "", alt: "x" }, { src: "" }], pdfs: [{ name: "a.pdf" }] };
  it("suggest carries the note and the first picture's look; save the target, and the files only for a note", () => {
    expect(suggestBody(page, "mine", "AAAA")).toEqual({ ...page, note: "mine", images: [{ src: "", alt: "x", look: "AAAA" }, { src: "" }] });
    expect(suggestBody({ url: U, title: "t" }, "", undefined)).toEqual({ url: U, title: "t", note: undefined, images: undefined });
    expect(saveBody(page, "line", { kind: "task", id: ID }, "", false, [], "saveidsaveidsav")).toEqual({ id: "saveidsaveidsav", url: U, title: "Page", selection: undefined, line: "line", target: { kind: "task", id: ID }, note: undefined, images: page.images, pdfs: page.pdfs, tags: undefined });
    expect(saveBody(page, undefined, NEW, "", false, ["work"], "saveidsaveidsav")).toMatchObject({ tags: ["work"] });
    expect(sendsFiles(page, NEW)).toBe(true);
    expect(sendsFiles(page, { kind: "note", path: "notes/a.md" })).toBe(true);
    expect(sendsFiles(page, { kind: "task", id: ID })).toBe(false);
    expect(sendsFiles(page, NEW_TASK)).toBe(true);
    expect(sendsFiles({ url: U, title: "t" }, NEW_TASK)).toBe(false);
    expect(sendsFiles({ url: U, title: "t" }, NEW)).toBe(false);
    expect(sendsFiles({ url: "", title: "t", pdfs: [{ name: "a.pdf" }] }, NEW)).toBe(true);
  });
  it("a summary asked for sends the flag and the page's text, which is otherwise not sent again", () => {
    const withText = { ...page, text: "The page's text." };
    expect(saveBody(withText, undefined, NEW, "", false, [], "saveidsaveidsav")).not.toHaveProperty("text");
    expect(saveBody(withText, undefined, NEW, "", false, [], "saveidsaveidsav")).not.toHaveProperty("summary");
    expect(saveBody(withText, undefined, NEW, "", true, [], "saveidsaveidsav")).toMatchObject({ summary: true, text: "The page's text." });
    // no page text (a share of a link): the flag alone (the server fetches the page)
    expect(JSON.parse(JSON.stringify(saveBody({ url: U, title: "Page" }, undefined, NEW, "", true, [], "saveidsaveidsav")))).toEqual({ id: "saveidsaveidsav", url: U, title: "Page", target: { kind: "new" }, summary: true });
  });
  it("a save's id is a record id's shape (client/ids.ts), and a new one every time", () => {
    const ids = new Set(Array.from({ length: 50 }, recordId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{15}$/);
  });
  it("the same save sent again keeps its id, any other save and one already landed get a new one", () => {
    const saves = saveBodies(recordId), args: Parameters<ReturnType<typeof saveBodies>["body"]> = [page, undefined, NEW, "note", false, ["a"]];
    const first = saves.body(...args).id;
    expect(saves.body(...args).id).toBe(first);                                       // pressed again after a failure
    expect(saves.body(page, undefined, NEW, "note", false, ["b"]).id).not.toBe(first); // another save
    const second = saves.body(...args).id;
    expect(second).not.toBe(first);
    saves.landed();
    expect(saves.body(...args).id).not.toBe(second);                                  // the same words once it was answered: a new save
  });
  it("the notice when a summary was asked for and not written", () => {
    const r = (summary?: ClipResult["summary"]): ClipResult => ({ kind: "note", path: "notes/a.md", title: "A", action: "created", summary });
    expect(summaryNotice(r())).toBeNull();
    expect(summaryNotice(r("added"))).toBeNull();
    expect(summaryNotice(r("skipped"))).toBe("Saved without a summary: there was no text to write it from.");
    expect(summaryNotice({ kind: "task", id: ID, title: "T", action: "appended", summary: "failed" })).toBe("Saved without a summary: it couldn't be written.");
  });
});

describe("the picture JEV looks at", () => {
  it("long edge 768 at most, short side 280 at least, ratio kept", () => {
    expect(lookSize(4000, 3000)).toEqual({ width: 768, height: 576 });
    expect(lookSize(500, 400)).toEqual({ width: 500, height: 400 });
    expect(lookSize(100, 100)).toEqual({ width: LOOK_MIN, height: LOOK_MIN });
    expect(lookSize(100, 50)).toEqual({ width: 560, height: 280 });
    const wide = lookSize(10000, 100);
    expect(wide.width).toBeLessThanOrEqual(LOOK_MAX);
    expect(lookSize(0, 0)).toEqual({ width: 768, height: 768 });
  });
});
