// The extension's two calls to the server (suggest, save), what it reads off the tab, and how a failure is worded. The
// request shapes themselves are packages/core's (test/clip.test.ts there); this file checks the extension sends them
// to the right route, in the right encoding, and reports the right thing when the server or Chrome says no.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ClipResult, Suggestions } from "@/core/clip";
import { findNotes, linkPage, pictureViaServer, readTab, save, SetupError, suggest, tagsFor, type Page } from "../src/clip";
import { type FakeChrome, installChrome } from "./chrome";

const SERVER = "https://notes.example.net:8443";
const realFetch = globalThis.fetch;

type Sent = { url: string; init: RequestInit };
let sent: Sent[];
let fake: FakeChrome;

/** Answers every request with `answer`; records what was sent. */
function serve(answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    sent.push({ url: String(url), init });
    return answer(String(url), init);
  }) as typeof fetch;
}
const ok = (body: unknown) => Response.json(body);

beforeEach(() => {
  sent = [];
  fake = installChrome();
  fake.sync.set("server", SERVER);
  fake.granted.add(`${SERVER}/*`);
});
afterEach(() => { globalThis.fetch = realFetch; });

const page: Page = { url: "https://example.com/a", title: "A", text: "the page's words" };

describe("reaching the server", () => {
  it("without an address, sends the owner to the options page, not to a retry", async () => {
    fake.sync.clear();
    serve(() => ok({}));
    const err = await suggest(page, "").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SetupError);
    expect((err as Error).message).toBe("Set the TEF Notes server's address first.");
    expect(sent).toEqual([]);
  });
  it("with an address Chrome has not granted, asks for the access", async () => {
    fake.granted.clear();
    serve(() => ok({}));
    const err = await suggest(page, "").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SetupError);
    expect((err as Error).message).toBe("Allow this extension to reach the server in its settings.");
    expect(sent).toEqual([]);
  });
  it("words a network failure for the owner, who is not told the browser's message", async () => {
    serve(() => { throw new TypeError("Failed to fetch"); });
    const err = await suggest(page, "").catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(SetupError);
    expect((err as Error).message).toBe("Can't reach the server. Check the address and that you are on the server's network.");
  });
  it("shows the server's own error, else its status", async () => {
    serve(() => Response.json({ error: "No such note." }, { status: 404 }));
    expect(((await suggest(page, "").catch((e: unknown) => e)) as Error).message).toBe("No such note.");
    serve(() => new Response("<html>bad gateway</html>", { status: 502 }));
    expect(((await suggest(page, "").catch((e: unknown) => e)) as Error).message).toBe("The server answered 502.");
    serve(() => Response.json({ message: "no error key" }, { status: 500 }));
    expect(((await suggest(page, "").catch((e: unknown) => e)) as Error).message).toBe("The server answered 500.");
  });
});

describe("suggest and the tags", () => {
  it("posts the page as JSON to the suggest route, the owner's note with it, and returns the answer", async () => {
    const answer: Suggestions = { suggestions: [], pick: { kind: "new" } };
    serve(() => ok(answer));
    expect(await suggest(page, "for the garden")).toEqual(answer);
    const [req] = sent;
    expect(req.url).toBe(`${SERVER}/api/tefnotes/clip/suggest`);
    expect(req.init.method).toBe("POST");
    expect((req.init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(req.init.body as string)).toEqual({ url: "https://example.com/a", title: "A", text: "the page's words", note: "for the garden" });
  });
  it("leaves an empty note out, and hands the picture's look to the first picture only", async () => {
    serve(() => ok({ suggestions: [], pick: { kind: "new" } }));
    const withPictures: Page = { ...page, images: [{ src: "https://example.com/1.jpg" }, { src: "https://example.com/2.jpg" }] };
    await suggest(withPictures, "", "BASE64");
    const body = JSON.parse(sent[0].init.body as string);
    expect("note" in body).toBe(false);
    expect(body.images).toEqual([{ src: "https://example.com/1.jpg", look: "BASE64" }, { src: "https://example.com/2.jpg" }]);
  });
  it("asks for the tags on their own route with the same body, no look", async () => {
    serve(() => ok({ tags: [{ name: "garden", p: 0.9 }], picked: ["garden"] }));
    expect(await tagsFor(page, "n")).toEqual({ tags: [{ name: "garden", p: 0.9 }], picked: ["garden"] });
    expect(sent[0].url).toBe(`${SERVER}/api/tefnotes/clip/tags`);
    expect(JSON.parse(sent[0].init.body as string)).toEqual({ url: "https://example.com/a", title: "A", text: "the page's words", note: "n" });
  });
});

describe("save", () => {
  const withPicture: Page = { ...page, images: [{ src: "https://example.com/1.jpg", alt: "a cat" }] };
  const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
  const result: ClipResult = { kind: "note", path: "notes/a.md", title: "A", action: "created" };
  const payload = (form: FormData) => JSON.parse(form.get("@jsonPayload") as string);

  it("sends the JSON payload as a multipart part, and the picture as `file` for a note", async () => {
    serve(() => ok(result));
    expect(await save(withPicture, "a line", { kind: "note", path: "notes/a.md" }, "mine", false, ["garden"], jpeg)).toEqual(result);
    const [req] = sent;
    expect(req.url).toBe(`${SERVER}/api/tefnotes/clip`);
    expect(req.init.method).toBe("POST");
    const form = req.init.body as FormData;
    expect(payload(form)).toEqual({
      url: "https://example.com/a", title: "A", line: "a line", note: "mine", tags: ["garden"],
      images: [{ src: "https://example.com/1.jpg", alt: "a cat" }], target: { kind: "note", path: "notes/a.md" },
    });
    const file = form.get("file") as File;
    expect(file.name).toBe("picture.jpg");
    expect(file.size).toBe(3);
  });
  it("sends the picture for a new note and a new task, never for an existing task", async () => {
    serve(() => ok(result));
    for (const [target, files] of [[{ kind: "new" }, 1], [{ kind: "newtask" }, 1], [{ kind: "task", id: "abc123def456ghi" }, 0]] as const) {
      sent = [];
      await save(withPicture, undefined, target, "", false, [], jpeg);
      expect((sent[0].init.body as FormData).getAll("file").length).toBe(files);
    }
  });
  it("sends no file for a page without a picture, even when a blob is handed in", async () => {
    serve(() => ok(result));
    await save(page, undefined, { kind: "new" }, "", false, [], jpeg);
    expect((sent[0].init.body as FormData).has("file")).toBe(false);
  });
  it("sends the page's text only when the summary box is ticked", async () => {
    serve(() => ok(result));
    await save(page, undefined, { kind: "new" }, "", false, []);
    expect(payload(sent[0].init.body as FormData).text).toBeUndefined();
    expect(payload(sent[0].init.body as FormData).summary).toBeUndefined();
    await save(page, undefined, { kind: "new" }, "", true, []);
    expect(payload(sent[1].init.body as FormData)).toMatchObject({ summary: true, text: "the page's words" });
  });
  it("names no content type itself, so the multipart boundary is the browser's", async () => {
    serve(() => ok(result));
    await save(page, undefined, { kind: "new" }, "", false, []);
    expect(sent[0].init.headers).toBeUndefined();
  });
});

describe("reading the tab", () => {
  const tab = (over: Partial<chrome.tabs.Tab> = {}) => ({ id: 7, url: "https://example.com/a", title: "A page", ...over }) as chrome.tabs.Tab;

  it("won't read a page it can't save: an internal one, or one with no id", async () => {
    for (const bad of [tab({ url: "chrome://extensions" }), tab({ url: "chrome-extension://abc/popup.html" }), tab({ url: "file:///home/x.html" }), tab({ url: undefined }), tab({ id: undefined })])
      await expect(readTab(bad)).rejects.toThrow("This page can't be saved.");
  });
  it("reads the selection and the text through a script injected into that tab, with the text's cap", async () => {
    fake.grabbed = { selection: "picked", text: "all the text", alt: "", caption: "" };
    expect(await readTab(tab())).toEqual({ url: "https://example.com/a", title: "A page", selection: "picked", text: "all the text" });
    expect(fake.injected).toEqual({ tabId: 7, args: [50000, null] });
  });
  it("prefers the selection the menu knew of, which also covers a frame the script can't see", async () => {
    fake.grabbed = { selection: "from the script", text: "t", alt: "", caption: "" };
    expect((await readTab(tab(), "from the menu")).selection).toBe("from the menu");
    expect((await readTab(tab(), "   ")).selection).toBe("from the script");
  });
  it("files a page the browser won't script by its address and title alone", async () => {
    fake.grabbed = null;
    expect(await readTab(tab())).toEqual({ url: "https://example.com/a", title: "A page", selection: undefined, text: undefined });
    expect((await readTab(tab({ title: "" }))).title).toBe("https://example.com/a");
  });
  it("drops what is blank, and carries the picture's alt text and caption when the menu was opened on one", async () => {
    fake.grabbed = { selection: "  ", text: "", alt: "a cat", caption: "Cat, 2024" };
    const read = await readTab(tab(), undefined, "https://example.com/cat.jpg");
    expect(read).toEqual({
      url: "https://example.com/a", title: "A page", selection: undefined, text: undefined,
      images: [{ src: "https://example.com/cat.jpg", alt: "a cat", caption: "Cat, 2024" }],
    });
    expect(fake.injected?.args).toEqual([50000, "https://example.com/cat.jpg"]);
  });
  it("still names the picture when the script couldn't run", async () => {
    fake.grabbed = null;
    expect((await readTab(tab(), undefined, "https://example.com/cat.jpg")).images).toEqual([{ src: "https://example.com/cat.jpg", alt: undefined, caption: undefined }]);
  });
  it("a link from the menu is its address, titled by it", () => {
    expect(linkPage("https://example.com/x")).toEqual({ url: "https://example.com/x", title: "https://example.com/x" });
  });
});

describe("a picture through the server", () => {
  it("asks for the address encoded in the query, and returns the bytes", async () => {
    serve(() => new Response(new Uint8Array([1, 2, 3])));
    const blob = await pictureViaServer("https://example.com/a b.jpg?x=1&y=2");
    expect(sent[0].url).toBe(`${SERVER}/api/tefnotes/clip/image?url=${encodeURIComponent("https://example.com/a b.jpg?x=1&y=2")}`);
    expect(blob.size).toBe(3);
  });
});

describe("finding a note to file into", () => {
  it("asks the notes collection for the newest matches by title or path, never an archived one, quoting the term", async () => {
    serve(() => ok({ items: [{ path: "notes/a.md", title: "A" }] }));
    expect(await findNotes('  my "quoted" term ')).toEqual([{ path: "notes/a.md", title: "A" }]);
    const url = new URL(sent[0].url);
    expect(`${url.origin}${url.pathname}`).toBe(`${SERVER}/api/collections/notes/records`);
    expect(url.searchParams.get("filter")).toBe('path ~ "notes/%" && archived != true && (title ~ "my \\"quoted\\" term" || path ~ "my \\"quoted\\" term")');
    expect(url.searchParams.get("sort")).toBe("-updated");
    expect(url.searchParams.get("perPage")).toBe("8");
    expect(url.searchParams.get("fields")).toBe("path,title");
  });
  it("is empty when the answer holds no items, and carries the caller's abort signal", async () => {
    serve(() => ok({}));
    const abort = new AbortController();
    expect(await findNotes("x", abort.signal)).toEqual([]);
    abort.abort();
    serve((_url, init) => { init.signal?.throwIfAborted(); return ok({ items: [] }); });
    await expect(findNotes("x", abort.signal)).rejects.toThrow("Can't reach the server");
  });
});
