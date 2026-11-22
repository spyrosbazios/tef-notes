// A note's PDFs as text for the agent: the first pages of each ride in the <context> when the note is open on screen
// (agent.ts), and read_attachment (tools.ts) reads any range of pages. A page's text is the PDF's own (pdf.js, through
// unpdf), extracted once per stored file and kept in memory: an attachment's stored file never changes (a new upload is
// a new file name). A scanned page has none of its own: its text is what OCR read off its picture (ocr.ts), which the
// background does for every stored PDF (`readScans`) and read_attachment waits for (`readNow`); until then, and with
// OCR off, it reads as empty. A PDF is someone else's text, like a web page: whatever the model reads of one taints the
// chat (guard.ts), so a write after it always asks. pdf.js and the canvas never run on the agent's event loop: every job
// here (text, page count, a tile's picture) is the render process's (render.ts).
import type { UIMessage } from "ai";
import { isPdf, PDF } from "@/core/photos";
import { parseNote } from "@/core/notes";
import * as pb from "@/core/client/pocketbase";
import { type Server, photoUrl, type ThumbSize } from "@/core/urls";
import { fileBytes } from "./chat-files";
import { ocr } from "./ocr";
import { render, RenderError } from "./render";
import { MAX_PAGES, type Doc } from "./semantic";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/** The context's preview: the first PREVIEW_PAGES of at most PREVIEW_PDFS PDFs, each cut at PREVIEW_CHARS. */
export const PREVIEW_PAGES = 2, PREVIEW_PDFS = 3, PREVIEW_CHARS = 4000;
/** read_attachment: at most this many characters a call. */
export const READ_CHARS = 30_000;
const KEPT = 32;                            // stored files whose text stays in memory

export type Pdf = { rec: string; name: string; file: string };
/** A page as the agent reads it. `scan`: the page has no text of its own, and `text` is what OCR read off it, this sure
 *  of it (0–100); "wait": not read yet; "failed": it couldn't be. */
export type Page = { text: string; scan?: number | "wait" | "failed" };

/** A page with fewer characters of its own than this is a scan: a picture of a page, with at most a page number, a stamp
 *  or the scanning app's watermark as text. A real page that short is read by OCR too, off its clean drawing. */
const SCAN_BELOW = 50;
const isScan = (text: string) => text.replace(/\s+/g, "").length < SCAN_BELOW;
/** Below this, OCR was mostly guessing (a photo of a page, a faint copy), and the page says so. */
const UNSURE = 60;
/** read_attachment waits for at most this many scanned pages a call (about what its character cap holds), this long. */
const ASK_PAGES = 12, ASK_MS = 60_000;

/** The stored file's name in OCR's books, and where its bytes are. */
const sourceOf = (server: Server, p: Pick<Pdf, "rec" | "file">) => ({ key: `${p.rec}/${p.file}`, url: photoUrl(server, p) });

/** The PDF itself can't be read (it wants a password, it is broken, it hangs or crashes pdf.js): no retry will change that. */
export class Unreadable extends Error {}

/** The stored file's bytes, for the render process. */
async function bytesOf(server: Server, p: Pick<Pdf, "rec" | "file">): Promise<Uint8Array> {
  const res = await fetch(photoUrl(server, p));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** A PDF's own text, one string per page, whitespace runs folded. `pdf` resolves to the bytes when the render process
 *  is ready for them. A failure of the job is the PDF's: Unreadable. */
async function textOf(pdf: () => Promise<Uint8Array>): Promise<string[]> {
  try {
    return (await render().run("text", async () => ({ pdf: await pdf() }))).map(fold);
  } catch (e) {
    throw e instanceof RenderError ? new Unreadable(e.message) : e;
  }
}
const fold = (t: string) => t.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();

const cache = new Map<string, Promise<string[]>>();

/** The PDF's own text, one string per page, whitespace runs folded. */
function own(server: Server, p: Pdf): Promise<string[]> {
  const key = `${p.rec}/${p.file}`, hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }        // newest last: the oldest goes first
  const run = textOf(() => bytesOf(server, p));
  run.catch(() => cache.delete(key));       // a failure is tried again next time
  cache.set(key, run);
  while (cache.size > KEPT) cache.delete(cache.keys().next().value!);
  return run;
}

/** The PDF's pages: each its own text, a scanned one what OCR has read of it so far. */
export async function pages(server: Server, p: Pdf): Promise<Page[]> {
  const text = await own(server, p), o = ocr();
  if (!o) return text.map((t) => ({ text: t }));
  const read = o.stored(sourceOf(server, p).key);
  return text.map((t, i) => {
    if (!isScan(t)) return { text: t };
    const r = read.get(i + 1);
    return !r ? { text: t, scan: "wait" } : r.conf < 0 ? { text: t, scan: "failed" } : { text: r.text || t, scan: r.conf };
  });
}

/** Has the scanned pages among `from`..`to` read now, ahead of the background, and waits for them at most `ms`: a page
 *  takes seconds, and what isn't back by then reads as not read yet, still on its way. No-op with OCR off. */
export async function readNow(server: Server, p: Pdf, from: number, to: number, ms = ASK_MS): Promise<void> {
  const o = ocr();
  if (!o) return;
  const text = await own(server, p), src = sourceOf(server, p), had = o.stored(src.key), ask: number[] = [];
  for (let n = Math.max(1, from); n <= Math.min(to, text.length) && ask.length < ASK_PAGES; n++) if (isScan(text[n - 1]!) && !had.has(n)) ask.push(n);
  if (ask.length) await Promise.race([o.want(src, ask), Bun.sleep(ms)]);
}

let sweep: Promise<void> | undefined;

/** The background's pass: queues the unread scanned pages of every stored PDF (the first MAX_PAGES of each, what search
 *  indexes; later ones are read when asked for), and forgets what was read of PDFs that are gone. One pass at a time.
 *  While the reader can't work (no language data yet) and is waiting out its back-off (ocr.ts `holding`), a pass opens
 *  no PDF: it would only be to queue what can't be read. */
export function readScans(server: Server): Promise<void> {
  const o = ocr();
  if (!o) return Promise.resolve();
  if (sweep) return sweep;
  const run = (async () => {
    if (o.holding()) return;
    const all = (await pb.photos(server)).filter((p) => isPdf(p.name));
    o.keep(new Set(all.map((p) => sourceOf(server, p).key)));
    for (const p of all) {
      if (o.holding()) break;
      const src = sourceOf(server, p);
      if (o.settled(src.key) || o.queued(src.key)) continue;
      let text: string[];
      try { text = await own(server, p); } catch (e) {
        if (e instanceof Unreadable) o.settle(src.key, e.message);       // else PocketBase didn't answer: the next pass
        continue;
      }
      o.queue(src, text.slice(0, MAX_PAGES).flatMap((t, i) => (isScan(t) ? [i + 1] : [])));
    }
  })();
  sweep = run;
  run.catch(() => {}).finally(() => { if (sweep === run) sweep = undefined; });
  return run;
}

/** The note's PDFs (`note`: the note's own id, parseNote's, which its attachments are filed under), as their records name them. */
export async function pdfsOf(server: Server, note: string): Promise<Pdf[]> {
  return (await pb.photos(server, note)).filter((p) => isPdf(p.name)).map(({ rec, name, file }) => ({ rec, name, file }));
}

/** Every note's PDFs for the search index (semantic.ts), from one listing of the attachments; text read on demand. A
 *  PDF's key carries how many of its scanned pages OCR has read, so its note is embedded again as they come in. */
export async function allPdfs(server: Server, notes: { path: string; text: string }[]): Promise<Doc[]> {
  const byId = new Map(notes.map((n) => [parseNote(n.path, n.text).id, n.path])), read = ocr()?.counts();
  return (await pb.photos(server)).flatMap((p) => {
    const path = isPdf(p.name) && byId.get(p.note), key = `${p.rec}/${p.file}`, n = read?.get(key);
    return path ? [{ path, key: n ? `${key}#${n}` : key, name: p.name, pages: async () => (await pages(server, p)).map((x) => x.text) }] : [];
  });
}

/** Pages `from`..`to` (1-based, inclusive) as one text, each under a `--- page N ---` line that says when the text is
 *  OCR's, cut at `max` characters. */
export function pageRange(all: Page[], from: number, to: number, max: number) {
  const last = Math.min(to, all.length);
  let text = "";
  for (let i = from; i <= last; i++) {
    const p = all[i - 1]!;
    const how = typeof p.scan !== "number" || !p.text ? "" : p.scan < UNSURE ? " (scanned, read by OCR, poorly: much of it may be wrong or missing)" : " (scanned, read by OCR: expect small errors)";
    const none = p.scan === "wait" ? "(scanned page, not read yet: read_attachment waits for it)" : p.scan === "failed" ? "(scanned page: it couldn't be read)" : "(no text on this page)";
    text += `${i > from ? "\n\n" : ""}--- page ${i}${how} ---\n${p.text || none}`;
  }
  return text.length > max ? { text: text.slice(0, max), cut: true } : { text, cut: false };
}

/** The open note's PDFs as the <context>'s <pdfs> block, or "" when it has none (or they can't be read: the chat goes on
 *  without them). Text is JSON-quoted so it can't close a tag. */
export async function preview(server: Server, note: { id: string; path: string }): Promise<string> {
  let list: Pdf[];
  try { list = await pdfsOf(server, note.id); } catch { return ""; }
  if (!list.length) return "";
  const q = (s: string) => JSON.stringify(s).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  const parts = await Promise.all(list.map(async (p, i) => {
    if (i >= PREVIEW_PDFS) return `${q(p.name)}: not previewed (read_attachment reads it)`;
    try {
      void readNow(server, p, 1, PREVIEW_PAGES, 0).catch(() => {});      // the note is open: its scans go first, unwaited
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
const thumbDir = () => join(process.env.TEF_NOTES_DATA ?? "./data", "pdf-thumbs");

/** The bytes at `path` on disk, else made by `make` and written there (a failed write only costs a redraw). */
async function onDisk(path: string, make: () => Promise<Uint8Array>): Promise<Uint8Array> {
  const f = Bun.file(path);
  if (await f.exists()) return new Uint8Array(await f.arrayBuffer());
  const out = await make();
  await mkdir(thumbDir(), { recursive: true }).then(() => Bun.write(path, out)).catch(() => {});
  return out;
}

/** The first page of the note's PDF `name` as JPEG at `size`; null when the note has no such PDF. */
export async function thumb(server: Server, note: string, name: string, size: ThumbSize = "sharp"): Promise<Uint8Array | null> {
  const p = (await pdfsOf(server, note)).find((x) => x.name === name);
  if (!p) return null;
  const base = `${p.rec}_${p.file.replace(/[^\w.-]/g, "_")}`, key = `${base}_${size}`, hit = thumbs.get(key);
  if (hit) { thumbs.delete(key); thumbs.set(key, hit); return hit; }
  const sharp = () => onDisk(join(thumbDir(), `${base}_sharp.jpg`), () =>
    render().run("thumb", async () => ({ pdf: await bytesOf(server, p), width: THUMB_WIDTH, quality: THUMB_QUALITY })));
  const run = size === "sharp" ? sharp() : onDisk(join(thumbDir(), `${base}_blur.jpg`), async () => render().run("shrink", { jpeg: await sharp(), width: BLUR_WIDTH }));
  run.catch(() => thumbs.delete(key));
  thumbs.set(key, run);
  while (thumbs.size > 64) thumbs.delete(thumbs.keys().next().value!);
  return run;
}

/** How many pages the note's PDF `name` has; null when the note has no such PDF. Counted once per stored file and kept
 *  on disk beside its pictures. */
export async function pageCount(server: Server, note: string, name: string): Promise<number | null> {
  const p = (await pdfsOf(server, note)).find((x) => x.name === name);
  if (!p) return null;
  const path = join(thumbDir(), `${p.rec}_${p.file.replace(/[^\w.-]/g, "_")}_pages.txt`), f = Bun.file(path);
  if (await f.exists()) { const n = Number(await f.text()); if (n > 0) return n; }
  const n = await render().run("pages", async () => ({ pdf: await bytesOf(server, p) }));
  await mkdir(thumbDir(), { recursive: true }).then(() => Bun.write(path, String(n))).catch(() => {});
  return n;
}

/** The query's note id and PDF name, or the 400 for a bad one. */
function pdfQuery(u: URL): { note: string; name: string } | Response {
  const note = u.searchParams.get("note") ?? "", name = u.searchParams.get("name") ?? "";
  return /^[^/]+$/.test(note) && /^[^/]+\.pdf$/i.test(name) ? { note, name } : new Response("note and name: a note's id and its PDF's name", { status: 400 });
}

/** GET /agent/pdf-pages?note=<the note's id>&name=<the PDF's name>: `{ pages }`, or 404. */
export async function pagesRoute(req: Request, server: Server): Promise<Response> {
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
export async function thumbRoute(req: Request, server: Server): Promise<Response> {
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

/** An attached PDF's text, its first READ_CHARS; its bytes are read once per server run (it rides in every later turn): a
 *  stored chat file's by its address, an older chat's inline data URL's by a hash of it. */
function attachedText(server: Server, url: string): Promise<string> {
  const key = url.startsWith("data:") ? String(Bun.hash(url)) : url, hit = attached.get(key);
  if (hit) return hit;
  const run = (async () => {
    const text = await textOf(() => fileBytes(server, url));
    const all = text.map((t, i) => `[page ${i + 1}]\n${t}`).join("\n\n");
    return all.length > READ_CHARS ? `${all.slice(0, READ_CHARS)}\n(cut at ${READ_CHARS} of ${all.length} characters)` : all;
  })();
  run.catch(() => attached.delete(key));
  attached.set(key, run);
  while (attached.size > KEPT) attached.delete(attached.keys().next().value!);
  return run;
}

/** The history with each attached PDF as its text: no provider is asked to read a PDF itself. A copy: the chat as saved
 *  keeps the file. Photos stay file parts, sent to the model as pictures (chat-files.ts `inlinePictures`). */
export async function inlinePdfs<M extends UIMessage>(server: Server, ms: M[]): Promise<M[]> {
  return Promise.all(ms.map(async (m) => (m.role !== "user" || !m.parts.some((p) => p.type === "file" && p.mediaType === PDF) ? m : {
    ...m,
    parts: await Promise.all(m.parts.map(async (p) => {
      if (p.type !== "file" || p.mediaType !== PDF) return p;
      const name = p.filename ?? "attachment.pdf";
      const body = await attachedText(server, p.url).catch((e: unknown) => `(Could not read it: ${(e as Error).message})`);
      return { type: "text" as const, text: `<attachment name=${JSON.stringify(name)}>\n${body}\n</attachment>` };
    })),
  } as M)));
}
