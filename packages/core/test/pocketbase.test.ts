// The notes server client (src/client/pocketbase.ts) against a stubbed fetch: what each call sends, and how
// PocketBase's answers become Conflict or null. No token: the private network is the gate.
import { afterEach, describe, expect, it, mock } from "bun:test";
import { HttpError } from "../src/client/http";
import { attachments, create, lenses, linkPreview, list, read, remove, search, tasks, unanswered, update } from "../src/client/pocketbase";
import { hasPreview } from "../src/hyperlinks";
import { Conflict, Gone, Refused, Unavailable, landed, likeLit } from "../src/record-contracts";
import { newTask } from "../src/todo";
import { photoThumbUrl, previewPictureUrl, serverUrl } from "../src/server-urls";

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
    expect(await create(S, "r1", "notes/a.md", text)).toEqual({ rec: "r1", path: "notes/a.md", rev: 1, text: "x", kind: "note" });
    const { url, init, body } = sent(f);
    expect(url).toBe("https://n:8097/api/collections/notes/records");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(body).toEqual({ id: "r1", path: "notes/a.md", text, title: "Garage", day: "2026-10-05", pinned: true, archived: false, color: "yellow", tags: ["home"] });
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

  it("a create at a taken path or record id is a Conflict; another refusal is Refused", async () => {
    for (const field of ["path", "id"]) {
      stubFetch(reply(400, { data: { [field]: { code: "validation_not_unique", message: "Value must be unique." } } }));
      await expect(create(S, "r1", "notes/a.md", "x")).rejects.toBeInstanceOf(Conflict);
    }
    stubFetch(reply(400, { data: { text: { code: "validation_max_text_constraint" } } }));
    await expect(create(S, "r1", "notes/a.md", "x")).rejects.toBeInstanceOf(Refused);
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
    const f = mock(async (url: string) => new Response(JSON.stringify(url.includes("filter=") ? page(3, 500) : page(500, 0))));
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

  it("an upload goes as a multipart form, without the JSON header; a name the note has already is a Conflict", async () => {
    const f = reply(200, { id: "p1", note: "n1", name: "a.jpg", file: "a_x.jpg" });
    stubFetch(f);
    expect(await attachments.upload(S, "n1", "a.jpg", new Blob(["x"]))).toEqual({ rec: "p1", note: "n1", name: "a.jpg", file: "a_x.jpg" });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect([url, init.method, init.body instanceof FormData, init.headers]).toEqual(["https://n:8097/api/collections/attachments/records", "POST", true, undefined]);
    stubFetch(reply(400, { data: { name: { code: "validation_not_unique" } } }));
    await expect(attachments.upload(S, "n1", "a.jpg", new Blob(["x"]))).rejects.toBeInstanceOf(Conflict);
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

  it("searches for every word as plain text: a typed % or _ is no wildcard (PocketBase takes a value with a bare % as a pattern)", async () => {
    const f = reply(200, { items: [] });
    stubFetch(f);
    await search(S, String.raw`100% a_b c\d "q"`);
    const both = (v: string) => `(title ~ ${v} || text ~ ${v})`;
    expect(new URL(sent(f).url).searchParams.get("filter")).toBe(
      ["path ~ \"notes/%\"", both(String.raw`"100\\%"`), both(String.raw`"a\\_b"`), both(String.raw`"c\\\\d"`), both(String.raw`"\"q\""`)].join(" && "),
    );
    expect(likeLit("plain")).toBe('"plain"');
  });
});

describe("a create sent again", () => {
  const text = "# A\n", path = "notes/a.md", row = { id: "r1", path, rev: 1, text, kind: "note" };
  const taken = (field: string) => new Response(JSON.stringify({ data: { [field]: { code: "validation_not_unique" } } }), { status: 400 });

  it("whose first answer was lost lands once: the repeat finds its own id taken and answers with the note there", async () => {
    let posts = 0;
    const ids = new Set<string>();
    stubFetch(async (_url, init) => {
      if (init?.method !== "POST") return new Response(JSON.stringify(row), { status: 200 });
      ids.add(JSON.parse(init.body as string).id);
      return ++posts === 1 ? new Response("{}", { status: 503 }) : taken("id");     // the first landed, its answer was lost
    });
    expect(await create(S, "r1", path, text)).toEqual({ rec: "r1", path, rev: 1, text, kind: "note" });
    expect(posts).toBe(2);
    expect([...ids]).toEqual(["r1"]);                                              // the same id, never a new one
  });

  it("is one POST when it worked", async () => {
    const f = reply(200, row);
    stubFetch(f);
    await create(S, "r1", path, text);
    expect(f.mock.calls.length).toBe(1);
  });

  it("an id held by a note of another path is a Conflict, not an answer", async () => {
    stubFetch(async (_url, init) => (init?.method === "POST" ? taken("id") : new Response(JSON.stringify({ ...row, path: "notes/other.md" }), { status: 200 })));
    await expect(create(S, "r1", path, text)).rejects.toBeInstanceOf(Conflict);
  });

  it("a path taken (nothing under the id) is a Conflict, and the id is still free for the next path", async () => {
    stubFetch(async (_url, init) => (init?.method === "POST" ? taken("path") : new Response("{}", { status: 404 })));
    await expect(create(S, "r1", path, text)).rejects.toBeInstanceOf(Conflict);
  });

  it("a server that refused (a 4xx) is not tried again", async () => {
    const f = reply(403, { message: "no" });
    stubFetch(f);
    await expect(create(S, "r1", path, text)).rejects.toBeInstanceOf(Refused);
    expect(f.mock.calls.length).toBe(1);
  });

  it("a task's create is read back the same way", async () => {
    let posts = 0;
    stubFetch(async (_url, init) => {
      if (init?.method === "POST") return ++posts === 1 ? new Response("{}", { status: 502 }) : taken("id");
      return new Response(JSON.stringify({ ...newTask("t1", { title: "T" }), rev: 1 }), { status: 200 });
    });
    expect((await tasks.create(S, newTask("t1", { title: "T" }))).id).toBe("t1");
    expect(posts).toBe(2);
  });

  it("a lens and a tag are created under an id of their own, sent again the same way", async () => {
    let posts = 0;
    const ids = new Set<string>();
    stubFetch(async (_url, init) => {
      if (init?.method !== "POST") return new Response(JSON.stringify({ id: [...ids][0], name: "Work", tags: [] }), { status: 200 });
      ids.add(JSON.parse(init.body as string).id);
      return ++posts === 1 ? new Response("{}", { status: 503 }) : taken("id");
    });
    expect((await lenses.create(S, { name: "Work", tags: [], exclude: [], accent: null, theme: null })).rec).toBe([...ids][0]);
    expect(ids.size).toBe(1);
  });
});

describe("a write whose answer was lost", () => {
  it("landed when the note is past the rev and holds the change; not when someone else's edit is all there is", () => {
    expect(landed("a\n", "a\nb\n", "a\nb\n")).toBe(true);
    expect(landed("a\n", "a\nb\n", "x\na\nb\n")).toBe(true);
    expect(landed("a\n", "a\nb\n", "x\na\n")).toBe(false);
  });
  it("is unanswered when nothing replied or the server failed, never when it refused", () => {
    for (const e of [new Error("socket closed"), new HttpError(503, "x"), new HttpError(429, "x"), new Unavailable("x")]) expect(unanswered(e)).toBe(true);
    for (const e of [new Conflict("x"), new Gone("x"), new Refused("x"), new HttpError(400, "x"), new HttpError(404, "x")]) expect(unanswered(e)).toBe(false);
  });
});
