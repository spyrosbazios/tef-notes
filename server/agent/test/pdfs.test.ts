// A note's PDFs as text: the pages, the context's preview of the open note's, read_attachment, and that reading one
// taints the chat like the web does.
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import type { ModelMessage } from "ai";
import { parseNote } from "@/core/notes";
import { fromWeb } from "../src/guard";
import { Notes } from "../src/notes";
import { pageRange, pages, pagesRoute, preview, PREVIEW_CHARS, thumbRoute } from "../src/pdfs";
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
    expect(await pages(server, { rec: a.id, name: a.name, file: a.file })).toEqual(["Page one rent 900", "Page two deposit", "Page three keys", "Page four signed"]);
  });

  it("marks each page and cuts a range at the cap", () => {
    expect(pageRange(["a", "", "c"], 2, 9, 1000)).toEqual({ text: "--- page 2 ---\n(no text on this page)\n\n--- page 3 ---\nc", cut: false });
    expect(pageRange(["x".repeat(50)], 1, 1, 20)).toEqual({ text: "--- page 1 ---\nxxxxx", cut: true });
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
