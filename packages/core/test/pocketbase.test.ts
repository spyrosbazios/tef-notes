// The notes server client (src/pocketbase.ts) against a stubbed fetch: what each call sends, and how
// PocketBase's answers become Conflict or null. No token: the private network is the gate.
import { afterEach, describe, expect, it, mock } from "bun:test";
import { Conflict, create, hasPreview, linkPreview, photoThumbUrl, previewPictureUrl, list, read, remove, serverUrl, tasks, update, uploaded, uploadTo } from "../src/pocketbase";
import { newTask } from "../src/todo";

const S = { url: "https://n:8097" };
const reply = (status: number, body: unknown = {}) => mock(async (_url: string, _init?: RequestInit) => new Response(status === 204 ? null : JSON.stringify(body), { status }));
const sent = (f: ReturnType<typeof reply>, i = 0) => { const [url, init] = f.mock.calls[i] as [string, RequestInit]; return { url, init, body: init.body ? JSON.parse(init.body as string) : undefined }; };
const realFetch = globalThis.fetch;
const stubFetch = (f: (url: string, init?: RequestInit) => Promise<Response>) => { globalThis.fetch = f as unknown as typeof fetch; };
afterEach(() => { globalThis.fetch = realFetch; });

describe("pocketbase", () => {
  it("normalises what was pasted for the server", () => {
    expect(["example.ts.net:8097", "https://example.ts.net:8097/", "https://example.ts.net:8097/_/", "https://example.ts.net:8097/api/"].map(serverUrl))
      .toEqual(Array(4).fill("https://example.ts.net:8097"));
    expect(serverUrl("http://localhost:8097")).toBe("http://localhost:8097");
    expect(serverUrl("  ")).toBe("");
  });

  it("creates with the frontmatter copied into columns, and no Authorization", async () => {
    const f = reply(200, { id: "r1", path: "notes/a.md", rev: 1, text: "x", kind: "note" });
    stubFetch(f);
    const text = "---\ntitle: Garage\ncreated: 2026-10-05\npinned: true\ncolor: yellow\ntags: [home]\n---\n1234\n";
    expect(await create(S, "notes/a.md", text)).toEqual({ rec: "r1", path: "notes/a.md", rev: 1, text: "x", kind: "note" });
    const { url, init, body } = sent(f);
    expect(url).toBe("https://n:8097/api/collections/notes/records");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(body).toEqual({ path: "notes/a.md", text, title: "Garage", day: "2026-10-05", pinned: true, archived: false, color: "yellow", tags: ["home"] });
  });

  it("an update names the rev it was based on; a stale one is a Conflict, a gone record null", async () => {
    const f = reply(200, { id: "r1", path: "notes/a.md", rev: 3, text: "y" });
    stubFetch(f);
    expect(await update(S, { rec: "r1", path: "notes/a.md", rev: 2 }, "y")).toMatchObject({ rev: 3 });
    expect(sent(f).url).toBe("https://n:8097/api/collections/notes/records/r1");
    expect(sent(f).body).toMatchObject({ rev: 2, text: "y", day: "" });
    stubFetch(reply(409, { status: 409, message: "This note changed since that version." }));
    await expect(update(S, { rec: "r1", path: "notes/a.md", rev: 2 }, "y")).rejects.toBeInstanceOf(Conflict);
    stubFetch(reply(404));
    expect(await update(S, { rec: "r1", path: "notes/a.md", rev: 2 }, "y")).toBeNull();
  });

  it("a create at a taken path is a Conflict", async () => {
    stubFetch(reply(400, { data: { path: { code: "validation_not_unique", message: "Value must be unique." } } }));
    await expect(create(S, "notes/a.md", "x")).rejects.toBeInstanceOf(Conflict);
    stubFetch(reply(400, { data: { text: { code: "validation_max_text_constraint" } } }));
    await expect(create(S, "notes/a.md", "x")).rejects.not.toBeInstanceOf(Conflict);
  });

  it("deletes with ?rev=, already gone being done", async () => {
    const f = reply(204);
    stubFetch(f);
    await remove(S, { rec: "r1", rev: 4 });
    expect(sent(f).url).toBe("https://n:8097/api/collections/notes/records/r1?rev=4");
    stubFetch(reply(404));
    await expect(remove(S, { rec: "r1", rev: 4 })).resolves.toBeUndefined();
  });

  it("lists every page of path, rev and kind, no text", async () => {
    const page = (n: number, from: number) => ({ items: Array.from({ length: n }, (_, i) => ({ id: `r${from + i}`, path: `notes/${from + i}.md`, rev: 1, kind: from + i === 501 ? "capture" : "note" })) });
    const f = mock(async (url: string) => new Response(JSON.stringify(url.includes("page=1&") ? page(500, 0) : page(3, 500))));
    stubFetch(f);
    const all = await list(S);
    expect(all).toHaveLength(503);
    expect(all[502]).toEqual({ rec: "r502", path: "notes/502.md", rev: 1, kind: "note" });
    expect(all[501].kind).toBe("note");       // an old capture reads as a note
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[0][0]).toContain("fields=id,path,rev,kind&");
  });

  it("reads by path with the path quoted into the filter", async () => {
    const f = reply(200, { items: [] });
    stubFetch(f);
    expect(await read(S, 'notes/say "hi".md')).toBeNull();
    expect(decodeURIComponent(sent(f).url)).toContain('filter=path = "notes/say \\"hi\\".md"');
  });

  it("an upload's reply: the photo, or Conflict when the note has one by that name", () => {
    expect(uploadTo(S, "n1", "a.jpg")).toEqual({ url: "https://n:8097/api/collections/attachments/records", fields: { note: "n1", name: "a.jpg" } });
    expect(uploaded(200, JSON.stringify({ id: "p1", note: "n1", name: "a.jpg", file: "a_x.jpg" }), "a.jpg")).toEqual({ rec: "p1", note: "n1", name: "a.jpg", file: "a_x.jpg" });
    expect(() => uploaded(400, JSON.stringify({ data: { note: { code: "validation_not_unique" } } }), "a.jpg")).toThrow(Conflict);
    expect(() => uploaded(500, "<html>", "a.jpg")).toThrow("HTTP 500");
  });
});

describe("tasks", () => {
  it("a create sends the task, an update only its changed fields and the rev", async () => {
    const f = reply(200, { id: "t1", title: "x", rev: 2, tags: ["a"] });
    stubFetch(f);
    const t = newTask("t1", { title: "x", tags: ["a"] });
    expect((await tasks.create(S, t)).tags).toEqual(["a"]);
    expect(sent(f, 0).body.tags).toEqual(["a"]);
    await tasks.update(S, "t1", 1, { tags: ["a", "c"] });
    expect(sent(f, 1).body).toEqual({ tags: ["a", "c"], rev: 1 });
  });
});

describe("link previews", () => {
  it("asks the server's route, the URL encoded once", async () => {
    const f = reply(200, { url: "https://x.io/a?b=1&c=2", title: "T", description: "", site: "x.io", image: "", icon: "" });
    stubFetch(f);
    expect((await linkPreview(S, "https://x.io/a?b=1&c=2")).title).toBe("T");
    expect(sent(f).url).toBe("https://n:8097/api/tefnotes/link-preview?url=https%3A%2F%2Fx.io%2Fa%3Fb%3D1%26c%3D2");
  });
  it("a URL the server won't read is a 400, which a caller can tell from an outage", async () => {
    stubFetch(reply(400, { message: "Not a public host." }));
    await expect(linkPreview(S, "http://localhost/")).rejects.toMatchObject({ status: 400 });
  });
  it("shows a card or a thumbnail only for a page with a title or a picture", () => {
    const p = { url: "u", title: "", description: "d", site: "s", image: "", icon: "i", picture: "" };
    expect([hasPreview(null), hasPreview(p), hasPreview({ ...p, title: "T" }), hasPreview({ ...p, image: "https://i/x.png" })]).toEqual([false, false, true, true]);
  });
  it("draws a tile's picture from the server's copy at a thumb size, never from the site", () => {
    const p = { url: "u", title: "T", description: "", site: "", image: "https://i/x.png", icon: "", picture: "r1/x_ab.png" };
    expect(previewPictureUrl(S, p, "blur")).toBe(`${S.url}/api/files/link_previews/r1/x_ab.png?thumb=32x32f`);
    expect(previewPictureUrl(S, { ...p, picture: "" }, "sharp")).toBeUndefined();
    expect(photoThumbUrl(S, { rec: "a", file: "b c.jpg" }, "sharp")).toBe(`${S.url}/api/files/attachments/a/b%20c.jpg?thumb=640x640f`);
  });
});
