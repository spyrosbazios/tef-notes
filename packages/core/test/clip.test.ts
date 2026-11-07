// The clip routes' shapes shared with the extension (src/clip.ts), a share as a clip, the picture JEV looks at.
import { describe, expect, it } from "bun:test";
import { choices, describe as said, NEW, NEW_TASK, saveBody, sendsFile, suggestBody, summaryNotice, targetOf, titled, type ClipResult, type Suggestions } from "../src/clip";
import { HttpError } from "../src/http";
import { LOOK_MAX, LOOK_MIN, lookSize } from "../src/photos";
import { clipError, clipped, clipTo } from "../src/pocketbase";
import { clipOf, type Shared } from "../src/share";

const S = (p: Partial<Shared>): Shared => ({ text: "", url: null, images: [], pdfs: [], title: null, ...p });
const U = "https://example.com/a";
const ID = "abc123def456ghi";

describe("a share as a clip", () => {
  it("a link, its page's title, the text as the selection, one photo as the picture", () => {
    expect(clipOf(S({ url: U }), "Page")).toEqual({ url: U, title: "Page" });
    expect(clipOf(S({ url: U, title: "From the app", text: "a quote" }), null)).toEqual({ url: U, title: "From the app", selection: "a quote" });
    expect(clipOf(S({ text: "just words" }), null)).toEqual({ url: "", title: "", selection: "just words" });
    expect(clipOf(S({ images: [{ uri: "file:///a.jpg", width: 1, height: 2 }] }), null)).toEqual({ url: "", title: "", image: { src: "" } });
  });
  it("none for what the clip routes don't take: PDFs, several photos", () => {
    const img = { uri: "file:///a.jpg", width: 1, height: 2 };
    expect(clipOf(S({ images: [img, img] }), null)).toBeNull();
    expect(clipOf(S({ url: U, pdfs: [{ uri: "f", name: "a.pdf" }] }), null)).toBeNull();
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
    expect(choices(s, false)).toEqual([
      { target: { kind: "task", id: ID }, label: "Add to task Plan", hint: "50%" },
      { target: { kind: "note", path: "notes/a.md" }, label: "Append to A", hint: "30%" },
      { target: { kind: "note", path: "notes/b.md" }, label: "Append to B", hint: "10%" },
      { target: NEW, label: "New note" },
      { target: NEW_TASK, label: "New task" },
    ]);
  });
  it("a new note first when it is the pick or there is none; a task's hint says a picture is only linked", () => {
    expect(choices({ ...s, pick: NEW }, false).map((c) => c.target.kind)).toEqual(["new", "note", "task", "note", "newtask"]);
    expect(choices({ suggestions: [], pick: NEW }, false)).toEqual([{ target: NEW, label: "New note" }, { target: NEW_TASK, label: "New task" }]);
    expect(choices(s, true)[0].hint).toBe("50%, link only");
    expect(choices(s, true).at(-1)).toEqual({ target: NEW_TASK, label: "New task", hint: "picture in a linked note" });
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
  const page = { url: U, title: "Page", image: { src: "", alt: "x" } };
  it("suggest carries the note and the picture's look; save the target, and a file only for a note's picture", () => {
    expect(suggestBody(page, "mine", "AAAA")).toEqual({ ...page, note: "mine", image: { src: "", alt: "x", look: "AAAA" } });
    expect(suggestBody({ url: U, title: "t" }, "", undefined)).toEqual({ url: U, title: "t", note: undefined, image: undefined });
    expect(saveBody(page, "line", { kind: "task", id: ID }, "", false)).toEqual({ url: U, title: "Page", selection: undefined, line: "line", target: { kind: "task", id: ID }, note: undefined, image: page.image, tags: undefined });
    expect(saveBody(page, undefined, NEW, "", false, ["work"])).toMatchObject({ tags: ["work"] });
    expect(sendsFile(page, NEW)).toBe(true);
    expect(sendsFile(page, { kind: "note", path: "notes/a.md" })).toBe(true);
    expect(sendsFile(page, { kind: "task", id: ID })).toBe(false);
    expect(sendsFile(page, NEW_TASK)).toBe(true);
    expect(sendsFile({ url: U, title: "t" }, NEW_TASK)).toBe(false);
    expect(sendsFile({ url: U, title: "t" }, NEW)).toBe(false);
  });
  it("a save goes up as one multipart field", () => {
    const to = clipTo({ url: "https://h:1" }, page, undefined, NEW, "n", false);
    expect(to.url).toBe("https://h:1/api/tefnotes/clip");
    expect(JSON.parse(to.fields["@jsonPayload"])).toMatchObject({ url: U, target: { kind: "new" }, note: "n" });
  });
  it("a summary asked for sends the flag and the page's text, which is otherwise not sent again", () => {
    const withText = { ...page, text: "The page's text." };
    expect(saveBody(withText, undefined, NEW, "", false)).not.toHaveProperty("text");
    expect(saveBody(withText, undefined, NEW, "", false)).not.toHaveProperty("summary");
    expect(saveBody(withText, undefined, NEW, "", true)).toMatchObject({ summary: true, text: "The page's text." });
    // the phone has no page text: the flag alone (the server fetches the page)
    expect(JSON.parse(JSON.stringify(saveBody({ url: U, title: "Page" }, undefined, NEW, "", true)))).toEqual({ url: U, title: "Page", target: { kind: "new" }, summary: true });
    expect(JSON.parse(clipTo({ url: "https://h:1" }, withText, undefined, NEW, "", true).fields["@jsonPayload"])).toMatchObject({ summary: true, text: "The page's text." });
  });
  it("the notice when a summary was asked for and not written", () => {
    const r = (summary?: ClipResult["summary"]): ClipResult => ({ kind: "note", path: "notes/a.md", title: "A", action: "created", summary });
    expect(summaryNotice(r())).toBeNull();
    expect(summaryNotice(r("added"))).toBeNull();
    expect(summaryNotice(r("skipped"))).toBe("Saved without a summary: there was no text to write it from.");
    expect(summaryNotice({ kind: "task", id: ID, title: "T", action: "appended", summary: "failed" })).toBe("Saved without a summary: it couldn't be written.");
  });
  it("the reply: where it went, or the server's own words for a refusal", () => {
    expect(clipped(200, JSON.stringify({ kind: "task", id: ID, title: "T", action: "appended" }))).toMatchObject({ kind: "task", id: ID });
    expect(clipped(200, JSON.stringify({ kind: "note", path: "notes/a.md", title: "A", action: "created", summary: "failed" })).summary).toBe("failed");
    expect(() => clipped(404, JSON.stringify({ error: "That task no longer exists." }))).toThrow(HttpError);
    try { clipped(404, JSON.stringify({ error: "That task no longer exists." })); } catch (e) { expect(clipError(e)).toBe("That task no longer exists."); }
    expect(() => clipped(200, "not json")).toThrow(HttpError);
    expect(clipError(new Error("network down"))).toBe("network down");
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
