// A note's PDFs as text for the agent: the first pages of each ride in the <context> when the note is open on screen
// (agent.ts), and read_attachment (tools.ts) reads any range of pages. The text is pdf.js's (unpdf), extracted once
// per stored file and kept in memory: an attachment's stored file never changes (a new upload is a new file name).
// A scanned PDF has no text layer and reads as empty pages. A PDF is someone else's text, like a web page: whatever
// the model reads of one taints the chat (guard.ts), so a write after it always asks.
import { extractText, getDocumentProxy, renderPageAsImage } from "unpdf";
import type { UIMessage } from "ai";
import { isPdf, PDF } from "@/core/photos";
import { parseNote } from "@/core/notes";
import * as pb from "@/core/pocketbase";
import type { Doc } from "./semantic";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/** The context's preview: the first PREVIEW_PAGES of at most PREVIEW_PDFS PDFs, each cut at PREVIEW_CHARS. */
export const PREVIEW_PAGES = 2, PREVIEW_PDFS = 3, PREVIEW_CHARS = 4000;
/** read_attachment: at most this many characters a call. */
export const READ_CHARS = 30_000;
const KEPT = 32;                            // stored files whose text stays in memory

export type Pdf = { rec: string; name: string; file: string };

const cache = new Map<string, Promise<string[]>>();

/** The PDF's text, one string per page, whitespace runs folded. */
export function pages(server: pb.Server, p: Pdf): Promise<string[]> {
  const key = `${p.rec}/${p.file}`, hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }        // newest last: the oldest goes first
  const run = (async () => {
    const res = await fetch(pb.photoUrl(server, p));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
    const { text } = await extractText(doc, { mergePages: false });
    return text.map((t) => t.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim());
  })();
  run.catch(() => cache.delete(key));       // a failure is tried again next time
  cache.set(key, run);
  while (cache.size > KEPT) cache.delete(cache.keys().next().value!);
  return run;
}

/** The note's PDFs (`note`: the note's own id, parseNote's, which its attachments are filed under), as their records name them. */
export async function pdfsOf(server: pb.Server, note: string): Promise<Pdf[]> {
  return (await pb.photos(server, note)).filter((p) => isPdf(p.name)).map(({ rec, name, file }) => ({ rec, name, file }));
}

/** Every note's PDFs for the search index (semantic.ts), from one listing of the attachments; text read on demand. */
export async function allPdfs(server: pb.Server, notes: { path: string; text: string }[]): Promise<Doc[]> {
  const byId = new Map(notes.map((n) => [parseNote(n.path, n.text).id, n.path]));
  return (await pb.photos(server)).flatMap((p) => {
    const path = isPdf(p.name) && byId.get(p.note);
    return path ? [{ path, key: `${p.rec}/${p.file}`, name: p.name, pages: () => pages(server, p) }] : [];
  });
}

/** Pages `from`..`to` (1-based, inclusive) as one text, each under a `--- page N ---` line, cut at `max` characters. */
export function pageRange(all: string[], from: number, to: number, max: number) {
  const last = Math.min(to, all.length);
  let text = "";
  for (let i = from; i <= last; i++) text += `${i > from ? "\n\n" : ""}--- page ${i} ---\n${all[i - 1] || "(no text on this page)"}`;
  return text.length > max ? { text: text.slice(0, max), cut: true } : { text, cut: false };
}

/** The open note's PDFs as the <context>'s <pdfs> block, or "" when it has none (or they can't be read: the chat goes on
 *  without them). Text is JSON-quoted so it can't close a tag. */
export async function preview(server: pb.Server, note: { id: string; path: string }): Promise<string> {
  let list: Pdf[];
  try { list = await pdfsOf(server, note.id); } catch { return ""; }
  if (!list.length) return "";
  const q = (s: string) => JSON.stringify(s).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  const parts = await Promise.all(list.map(async (p, i) => {
    if (i >= PREVIEW_PDFS) return `${q(p.name)}: not previewed (read_attachment reads it)`;
    try {
      const all = await pages(server, p);
      const { text, cut } = pageRange(all, 1, PREVIEW_PAGES, PREVIEW_CHARS);
      const more = all.length > PREVIEW_PAGES || cut ? ` — the rest: read_attachment` : "";
      return `${q(p.name)} (${all.length} page${all.length === 1 ? "" : "s"}${more}):\n${q(text)}`;
    } catch {
      return `${q(p.name)}: couldn't be read`;
    }
  }));
  return `<pdfs note=${q(note.path)}>\n${parts.join("\n\n")}\n</pdfs>`;
}

// ---- a tile's picture

/** A tile's picture of a PDF: its first page as JPEG, at a tile's two sizes (`ThumbSize`): `sharp` this wide, `blur`
 *  that one shrunk to BLUR_WIDTH. Drawn once per stored file (which never changes) and kept on disk under
 *  TEF_NOTES_DATA, so a restart doesn't draw them again; the newest 64 also in memory. */
export const THUMB_WIDTH = 640, BLUR_WIDTH = 32, THUMB_QUALITY = 0.8;
const thumbs = new Map<string, Promise<Uint8Array>>();
let rendering: Promise<unknown> = Promise.resolve();       // one page at a time: four cores, and the agent's chat beside it
const thumbDir = () => join(process.env.TEF_NOTES_DATA ?? "./data", "pdf-thumbs");

/** The bytes at `path` on disk, else made by `make` and written there (a failed write only costs a redraw). */
async function onDisk(path: string, make: () => Promise<Uint8Array>): Promise<Uint8Array> {
  const f = Bun.file(path);
  if (await f.exists()) return new Uint8Array(await f.arrayBuffer());
  const out = await make();
  await mkdir(thumbDir(), { recursive: true }).then(() => Bun.write(path, out)).catch(() => {});
  return out;
}

/** `jpeg` shrunk to `width`, as JPEG. */
async function shrink(jpeg: Uint8Array, width: number): Promise<Uint8Array> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const img = await loadImage(Buffer.from(jpeg));
  const c = createCanvas(width, Math.max(1, Math.round((img.height * width) / img.width)));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return new Uint8Array(await c.encode("jpeg", 70));
}

/** The first page of the note's PDF `name` as JPEG at `size`; null when the note has no such PDF. */
export async function thumb(server: pb.Server, note: string, name: string, size: pb.ThumbSize = "sharp"): Promise<Uint8Array | null> {
  const p = (await pdfsOf(server, note)).find((x) => x.name === name);
  if (!p) return null;
  const base = `${p.rec}_${p.file.replace(/[^\w.-]/g, "_")}`, key = `${base}_${size}`, hit = thumbs.get(key);
  if (hit) { thumbs.delete(key); thumbs.set(key, hit); return hit; }
  const sharp = () => onDisk(join(thumbDir(), `${base}_sharp.jpg`), () => {
    const run = rendering.catch(() => {}).then(async () => {
      const res = await fetch(pb.photoUrl(server, p));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const doc = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
      return new Uint8Array(await renderPageAsImage(doc, 1, { canvasImport: () => import("@napi-rs/canvas"), width: THUMB_WIDTH, format: "jpeg", quality: THUMB_QUALITY }));
    });
    rendering = run;
    return run;
  });
  const run = size === "sharp" ? sharp() : onDisk(join(thumbDir(), `${base}_blur.jpg`), async () => shrink(await sharp(), BLUR_WIDTH));
  run.catch(() => thumbs.delete(key));
  thumbs.set(key, run);
  while (thumbs.size > 64) thumbs.delete(thumbs.keys().next().value!);
  return run;
}

/** How many pages the note's PDF `name` has; null when the note has no such PDF. Counted once per stored file and kept
 *  on disk beside its pictures. */
export async function pageCount(server: pb.Server, note: string, name: string): Promise<number | null> {
  const p = (await pdfsOf(server, note)).find((x) => x.name === name);
  if (!p) return null;
  const path = join(thumbDir(), `${p.rec}_${p.file.replace(/[^\w.-]/g, "_")}_pages.txt`), f = Bun.file(path);
  if (await f.exists()) { const n = Number(await f.text()); if (n > 0) return n; }
  const res = await fetch(pb.photoUrl(server, p));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const n = (await getDocumentProxy(new Uint8Array(await res.arrayBuffer()))).numPages;
  await mkdir(thumbDir(), { recursive: true }).then(() => Bun.write(path, String(n))).catch(() => {});
  return n;
}

/** The query's note id and PDF name, or the 400 for a bad one. */
function pdfQuery(u: URL): { note: string; name: string } | Response {
  const note = u.searchParams.get("note") ?? "", name = u.searchParams.get("name") ?? "";
  return /^[^/]+$/.test(note) && /^[^/]+\.pdf$/i.test(name) ? { note, name } : new Response("note and name: a note's id and its PDF's name", { status: 400 });
}

/** GET /agent/pdf-pages?note=<the note's id>&name=<the PDF's name>: `{ pages }`, or 404. */
export async function pagesRoute(req: Request, server: pb.Server): Promise<Response> {
  const q = pdfQuery(new URL(req.url));
  if (q instanceof Response) return q;
  let n: number | null;
  try { n = await pageCount(server, q.note, q.name); } catch (e) {
    return new Response(`Couldn't read ${q.name}: ${(e as Error).message}`, { status: 422 });
  }
  if (n === null) return new Response("No such PDF", { status: 404 });
  return Response.json({ pages: n }, { headers: { "Cache-Control": "public, max-age=604800" } });
}

/** GET /agent/pdf-thumb?note=<the note's id>&name=<the PDF's name>&size=<blur|sharp, default sharp>: the JPEG, or 404. */
export async function thumbRoute(req: Request, server: pb.Server): Promise<Response> {
  const u = new URL(req.url), q = pdfQuery(u), size = u.searchParams.get("size") ?? "sharp";
  if (q instanceof Response) return q;
  if (size !== "sharp" && size !== "blur") return new Response("size: blur or sharp", { status: 400 });
  const { note, name } = q;
  let img: Uint8Array | null;
  try { img = await thumb(server, note, name, size); } catch (e) {
    return new Response(`Couldn't draw ${name}: ${(e as Error).message}`, { status: 422 });
  }
  if (!img) return new Response("No such PDF", { status: 404 });
  return new Response(new Blob([img as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }), { headers: { "Cache-Control": "public, max-age=604800, immutable" } });
}

// ---- PDFs the owner attached to a chat message (core/assistant.ts "Attachments") ----
const attached = new Map<string, Promise<string>>();

/** An attached PDF's text, its first READ_CHARS; a data URL's bytes are read once per server run (it rides in every later request). */
function attachedText(url: string): Promise<string> {
  const key = String(Bun.hash(url)), hit = attached.get(key);
  if (hit) return hit;
  const run = (async () => {
    const comma = url.indexOf(",");
    if (!url.startsWith("data:") || comma < 0) throw new Error("not a data URL");
    const doc = await getDocumentProxy(new Uint8Array(Buffer.from(url.slice(comma + 1), "base64")));
    const { text } = await extractText(doc, { mergePages: false });
    const all = text.map((t, i) => `[page ${i + 1}]\n${t.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim()}`).join("\n\n");
    return all.length > READ_CHARS ? `${all.slice(0, READ_CHARS)}\n(cut at ${READ_CHARS} of ${all.length} characters)` : all;
  })();
  run.catch(() => attached.delete(key));
  attached.set(key, run);
  while (attached.size > KEPT) attached.delete(attached.keys().next().value!);
  return run;
}

/** The history with each attached PDF as its text: no provider is asked to read a PDF itself. A copy: the chat as saved
 *  keeps the file. Photos stay file parts, sent to the model as pictures. */
export async function inlinePdfs<M extends UIMessage>(ms: M[]): Promise<M[]> {
  return Promise.all(ms.map(async (m) => (m.role !== "user" || !m.parts.some((p) => p.type === "file" && p.mediaType === PDF) ? m : {
    ...m,
    parts: await Promise.all(m.parts.map(async (p) => {
      if (p.type !== "file" || p.mediaType !== PDF) return p;
      const name = p.filename ?? "attachment.pdf";
      const body = await attachedText(p.url).catch((e: unknown) => `(Could not read it: ${(e as Error).message})`);
      return { type: "text" as const, text: `<attachment name=${JSON.stringify(name)}>\n${body}\n</attachment>` };
    })),
  } as M)));
}
