// A note's PDFs as text: the pages, the context's preview of the open note's, read_attachment, and that reading one
// taints the chat like the web does. Scanned pages: read by OCR (a stand-in for Tesseract), in the background and when
// asked for.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ModelMessage } from "ai";
import { parseNote } from "@/core/notes";
import { fromWeb } from "../src/tools";
import { Notes } from "../src/notes";
import { Ocr, useOcr, type Reader } from "../src/ocr";
import { allPdfs, pageRange, pages, pagesRoute, preview, PREVIEW_CHARS, readNow, readScans, thumbRoute } from "../src/pdfs";
import { Todo } from "../src/todo";
import { tools } from "../src/tools";
import { fakePb } from "./fake-pb";
import { makePdf } from "./pdf";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const data = process.env.TEF_NOTES_DATA = mkdtempSync(join(tmpdir(), "pdf-thumbs-"));   // the tile pictures' disk cache
afterAll(() => rmSync(data, { recursive: true, force: true }));

const pb = fakePb();
afterAll(() => pb.stop());
const server = { url: pb.url };
const PATH = "notes/20261101-lease.md";
let id = "";

beforeEach(() => {
  pb.notes.clear(); pb.attachments.clear();
  pb.put(PATH, "---\ntitle: Lease\ncreated: 2026-11-01\n---\n[Lease.pdf](../attachments/x/lease.pdf)\n");
  id = parseNote(PATH, "").id;
  pb.attach(id, "lease.pdf", makePdf(["Page one rent 900", "Page two deposit", "Page three keys", "Page four signed"]));
});

const run = async (name: string, input: object) =>
  (tools(new Notes(server), new Todo(server)) as any)[name].execute(input, { messages: [], toolCallId: "t" });

describe("pdfs", () => {
  it("reads a PDF's text page by page", async () => {
    const [a] = [...pb.attachments.values()];
    expect(await pages(server, { rec: a.id, name: a.name, file: a.file })).toEqual(["Page one rent 900", "Page two deposit", "Page three keys", "Page four signed"].map((text) => ({ text })));
  });

  it("marks each page and cuts a range at the cap", () => {
    expect(pageRange([{ text: "a" }, { text: "" }, { text: "c" }], 2, 9, 1000)).toEqual({ text: "--- page 2 ---\n(no text on this page)\n\n--- page 3 ---\nc", cut: false });
    expect(pageRange([{ text: "x".repeat(50) }], 1, 1, 20)).toEqual({ text: "--- page 1 ---\nxxxxx", cut: true });
  });

  it("says on a page's line when its text is OCR's, and how a scanned page without text stands", () => {
    const all = [{ text: "clear", scan: 91 }, { text: "faint", scan: 40 }, { text: "", scan: "wait" as const }, { text: "", scan: "failed" as const }, { text: "", scan: 0 }];
    expect(pageRange(all, 1, 5, 1000).text).toBe([
      "--- page 1 (scanned, read by OCR: expect small errors) ---\nclear",
      "--- page 2 (scanned, read by OCR, poorly: much of it may be wrong or missing) ---\nfaint",
      "--- page 3 ---\n(scanned page, not read yet: read_attachment waits for it)",
      "--- page 4 ---\n(scanned page: it couldn't be read)",
      "--- page 5 ---\n(no text on this page)",
    ].join("\n\n"));
  });

  it("previews the first two pages of the open note's PDFs, quoted, and says how to read the rest", async () => {
    const p = await preview(server, { id, path: PATH });
    expect(p).toStartWith(`<pdfs note="${PATH}">`);
    expect(p).toContain(`"lease.pdf" (4 pages — the rest: read_attachment)`);
    expect(p).toContain("Page two deposit");
    expect(p).not.toContain("Page three");
    expect(p.length).toBeLessThan(PREVIEW_CHARS + 500);
  });

  it("previews nothing for a note without PDFs", async () => {
    pb.attachments.clear();
    expect(await preview(server, { id, path: PATH })).toBe("");
  });

  it("read_attachment reads a range, and names the PDFs a note has when the name is wrong", async () => {
    const r = await run("read_attachment", { path: PATH, name: "lease.pdf", from: 3 });
    expect(r).toMatchObject({ name: "lease.pdf", pages: 4, from: 3, to: 4 });
    expect(r.text).toBe("--- page 3 ---\nPage three keys\n\n--- page 4 ---\nPage four signed");
    expect(await run("read_attachment", { path: PATH, name: "nope.pdf" })).toEqual({ error: `${PATH} has no PDF nope.pdf. It has: lease.pdf.` });
    expect(await run("read_attachment", { path: PATH, name: "lease.pdf", from: 9 })).toEqual({ error: "lease.pdf has 4 pages." });
    expect(await run("read_attachment", { path: "notes/none.md", name: "lease.pdf" })).toEqual({ error: "No note notes/none.md." });
  });

  it("taints the chat once a PDF was read", () => {
    const read = (toolName: string): ModelMessage[] => [{ role: "tool", content: [{ type: "tool-result", toolCallId: "t", toolName, output: { type: "json", value: {} } }] }];
    expect(fromWeb(read("read_attachment"))).toBe(true);
    expect(fromWeb(read("read_note"))).toBe(false);
  });

  it("draws the first page as a JPEG for a tile, and 404s a PDF the note hasn't", async () => {
    const get = (q: string) => thumbRoute(new Request(`http://x/agent/pdf-thumb?${q}`), server);
    const ok = await get(`note=${id}&name=lease.pdf`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/jpeg");
    expect([...new Uint8Array(await ok.arrayBuffer()).slice(0, 2)]).toEqual([0xff, 0xd8]);
    expect((await get(`note=${id}&name=nope.pdf`)).status).toBe(404);
    expect((await get(`note=a/b&name=lease.pdf`)).status).toBe(400);
    expect((await get(`note=${id}&name=lease.pdf&size=huge`)).status).toBe(400);
    const blur = new Uint8Array(await (await get(`note=${id}&name=lease.pdf&size=blur`)).arrayBuffer());
    expect([...blur.slice(0, 2)]).toEqual([0xff, 0xd8]);
    expect(blur.length).toBeLessThan(new Uint8Array(await (await get(`note=${id}&name=lease.pdf`)).arrayBuffer()).length);
  });

  it("counts a PDF's pages, twice from the disk the same, and 404s a PDF the note hasn't", async () => {
    const get = (q: string) => pagesRoute(new Request(`http://x/agent/pdf-pages?${q}`), server);
    expect(await (await get(`note=${id}&name=lease.pdf`)).json()).toEqual({ pages: 4 });
    expect(await (await get(`note=${id}&name=lease.pdf`)).json()).toEqual({ pages: 4 });
    expect((await get(`note=${id}&name=nope.pdf`)).status).toBe(404);
    expect((await get(`note=a/b&name=lease.pdf`)).status).toBe(400);
  });
});

describe("scanned pages", () => {
  const TEXT = "A page with text of its own: sixty characters or so, which is enough to count as one";
  /** Tesseract's stand-in: every page reads as "scan <n>", the first one faintly; `asked` is what it was sent. */
  let asked: number[][] = [];
  const reader: Reader = async (_url, list, got) => { asked.push(list); for (const page of list) got({ page, text: `scan ${page}`, conf: page === 1 ? 40 : 90 }); };
  let o: Ocr;
  const scan = () => { const [a] = [...pb.attachments.values()]; return { rec: a.id, name: a.name, file: a.file }; };

  beforeEach(() => {
    asked = [];
    useOcr(o = new Ocr(reader, "test"));
    pb.attachments.clear();
    pb.attach(id, "lease.pdf", makePdf(["", TEXT, ""]));       // pages 1 and 3 are scans
  });
  afterEach(() => useOcr(null));

  it("reads as not read yet, then as what OCR made of it; a page with text of its own is left alone", async () => {
    expect(await pages(server, scan())).toEqual([{ text: "", scan: "wait" }, { text: TEXT }, { text: "", scan: "wait" }]);
    await readNow(server, scan(), 1, 3);
    expect(asked).toEqual([[1, 3]]);
    expect(await pages(server, scan())).toEqual([{ text: "scan 1", scan: 40 }, { text: TEXT }, { text: "scan 3", scan: 90 }]);
    await readNow(server, scan(), 1, 3);
    expect(asked).toEqual([[1, 3]]);                           // read once
  });

  it("the background reads every stored PDF's scans once, and forgets a PDF that is gone", async () => {
    pb.attach(id, "text.pdf", makePdf([TEXT]));
    await readScans(server);
    await o.idle();
    expect(asked).toEqual([[1, 3]]);
    expect(o.status()).toMatchObject({ read: 2, waiting: 0, failedPages: 0, failedPdfs: 0 });
    await readScans(server);
    await o.idle();
    expect(asked).toEqual([[1, 3]]);                           // both files settled: nothing is opened again
    pb.attachments.clear();
    await readScans(server);
    expect(o.status().read).toBe(0);
  });

  it("gives up at once on a PDF that can't be opened", async () => {
    pb.attachments.clear();
    pb.attach(id, "broken.pdf", new TextEncoder().encode("not a PDF"));
    await readScans(server);
    await o.idle();
    expect(asked).toEqual([]);
    expect(o.status().failedPdfs).toBe(1);
  });

  it("read_attachment waits for the scans in its range and marks them", async () => {
    const r = await run("read_attachment", { path: PATH, name: "lease.pdf" });
    expect(r.text).toBe(`--- page 1 (scanned, read by OCR, poorly: much of it may be wrong or missing) ---\nscan 1\n\n--- page 2 ---\n${TEXT}\n\n--- page 3 (scanned, read by OCR: expect small errors) ---\nscan 3`);
  });

  it("the open note's preview starts its scans and doesn't wait for them", async () => {
    useOcr(o = new Ocr(async (_url, list, got) => { await Bun.sleep(20); for (const page of list) got({ page, text: `scan ${page}`, conf: 90 }); }, "test"));
    expect(await preview(server, { id, path: PATH })).toContain("(scanned page, not read yet: read_attachment waits for it)");
    await o.idle();
    expect(await preview(server, { id, path: PATH })).toContain("scan 1");
  });

  it("names a PDF anew for the search index once its scans are read, so its note is embedded again", async () => {
    const notes = [{ path: PATH, text: "" }], key = async () => (await allPdfs(server, notes))[0]!.key;
    const before = await key();
    await readNow(server, scan(), 1, 3);
    expect(await key()).toBe(`${before}#2`);
    expect(await (await allPdfs(server, notes))[0]!.pages()).toEqual(["scan 1", TEXT, "scan 3"]);
  });
});
