// The web share target: Android's form as a share, and the stash that carries it from the service worker to the page.
import { describe, expect, it } from "bun:test";
import { NEW, NEW_TASK } from "../src/clip";
import type { Lens } from "../src/lens";
import { clipOf, clipTags, fromPasted, fromPost } from "../src/share";
import { stashPost, takePost, type Stash } from "../src/share-stash";

const U = "https://example.com/a?b=1";
const none = { title: "", text: "", url: "", files: [] };

describe("Android's form as a share", () => {
  it("finds the link in text, in title, or in url", () => {
    expect(fromPost({ ...none, text: U })).toEqual({ text: "", url: U, images: [], pdfs: [], title: null });
    expect(fromPost({ ...none, title: "A page", text: `A page\n${U}` })).toEqual({ text: "", url: U, images: [], pdfs: [], title: "A page" });
    expect(fromPost({ ...none, text: `Look at this: ${U}.` })).toMatchObject({ url: U, text: `Look at this: ${U}.` });
    expect(fromPost({ ...none, title: U })).toMatchObject({ url: U, title: null });
    expect(fromPost({ ...none, url: U, text: "words" })).toMatchObject({ url: U, text: "words" });
    expect(fromPost({ ...none, text: "just words" })).toEqual({ text: "just words", url: null, images: [], pdfs: [], title: null });
  });
  it("takes images and PDFs, a file's uri its place in the list; other files are left out; null for nothing", () => {
    const files = [{ name: "a.jpg", type: "image/jpeg" }, { name: "v.mp4", type: "video/mp4" }, { name: "Tax form.pdf", type: "application/pdf" }, { name: "b.pdf", type: "" }];
    expect(fromPost({ ...none, files })).toEqual({
      text: "", url: null, title: null, images: [{ uri: "0", width: null, height: null }],
      pdfs: [{ uri: "2", name: "Tax form.pdf" }, { uri: "3", name: "b.pdf" }],
    });
    expect(fromPost({ ...none, files: [files[1]] })).toBeNull();
    expect(fromPost(none)).toBeNull();
    expect(fromPasted("   ")).toBeNull();
    expect(fromPasted(U)).toMatchObject({ url: U });
  });
  it("one photo or a link is a clip; a PDF or several photos are not", () => {
    expect(clipOf(fromPost({ ...none, text: U })!, "Page")).toEqual({ url: U, title: "Page" });
    expect(clipOf(fromPost({ ...none, files: [{ name: "a.png", type: "image/png" }] })!, null)).toEqual({ url: "", title: "", image: { src: "" } });
    expect(clipOf(fromPost({ ...none, files: [{ name: "a.png", type: "image/png" }, { name: "b.png", type: "image/png" }] })!, null)).toBeNull();
    expect(clipOf(fromPost({ ...none, files: [{ name: "a.pdf", type: "application/pdf" }] })!, null)).toBeNull();
  });
});

describe("what a lens gives a clip", () => {
  const work: Lens = { rec: "w", name: "Work", tags: ["work", "clients"], exclude: [], accent: null };
  it("its first tag to what is made, nothing to what is appended to", () => {
    expect(clipTags(NEW, work)).toEqual(["work"]);
    expect(clipTags(NEW_TASK, work)).toEqual(["work"]);
    expect(clipTags({ kind: "note", path: "notes/a.md" }, work)).toEqual([]);
    expect(clipTags({ kind: "task", id: "t" }, work)).toEqual([]);
    expect(clipTags(NEW, null)).toEqual([]);
  });
});

/** A Cache on a map: keyed by path, as the stash names its entries. */
function fake(): Stash {
  const m = new Map<string, Response>();
  const key = (r: RequestInfo | URL) => (typeof r === "string" ? r : new URL(r instanceof Request ? r.url : String(r)).pathname);
  return {
    put: async (r, res) => { m.set(key(r), res); },
    match: async (r) => m.get(key(r))?.clone(),
    keys: async () => [...m.keys()].map((k) => new Request(`https://app.test${k}`)),
    delete: async (r) => m.delete(key(r)),
  };
}

describe("the stash", () => {
  it("carries a share's text and files once, and is empty after", async () => {
    const cache = fake(), form = new FormData();
    form.set("title", "A page"); form.set("text", `A page ${U}`);
    form.append("files", new File(["abc"], "a.jpg", { type: "image/jpeg" }));
    form.append("files", new File(["%PDF"], "Tax form.pdf", { type: "application/pdf" }));
    await stashPost(cache, form);
    const got = await takePost(cache);
    expect(got).toMatchObject({ title: "A page", text: `A page ${U}`, url: "" });
    expect(got?.files.map((f) => [f.name, f.type, f.size])).toEqual([["a.jpg", "image/jpeg", 3], ["Tax form.pdf", "application/pdf", 4]]);
    expect(await got?.files[0].text()).toBe("abc");
    expect(await takePost(cache)).toBeNull();
    expect(await cache.keys()).toEqual([]);
  });
  it("a newer share replaces an older one that was never taken", async () => {
    const cache = fake(), one = new FormData(), two = new FormData();
    one.set("text", "first"); one.append("files", new File(["x"], "a.png", { type: "image/png" }));
    two.set("text", "second");
    await stashPost(cache, one);
    await stashPost(cache, two);
    expect(await takePost(cache)).toMatchObject({ text: "second", files: [] });
  });
  it("is null when nothing was shared", async () => {
    expect(await takePost(fake())).toBeNull();
  });
});
