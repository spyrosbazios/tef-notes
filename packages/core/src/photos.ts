// A file added to a note, on whichever client adds it. A photo: downscaled to a long edge of 1600 px as JPEG 0.82 (a
// phone photo is 3-5 MB, this a few hundred KB), named for the moment it was added, shown in the body as an image
// line. A PDF: kept as it is under its own (cleaned) name, shown as a link whose text is that name. A drawing: the
// web app's Excalidraw scene, kept beside a PNG preview of it, shown as a link to the scene.
import { ATTACHMENTS, slugify } from "./notes";

export const MAX = 1600, QUALITY = 0.82;

/** The resize that brings the long edge down to `max`, ratio kept; null when it's within already (or unknown, 0). */
export function fit(width: number, height: number, max = MAX): { width: number } | { height: number } | null {
  if (Math.max(width, height) <= max) return null;
  return width >= height ? { width: max } : { height: max };
}

/** The picture JEV looks at (TypeSafe takes 280 to 1568 px a side): long edge 768 as JPEG 0.8, a smaller one made up to
 *  280 on its short side. The extension pads its canvas to that (extension/src/picture.ts); the phone resizes up. */
export const LOOK = 768, LOOK_MIN = 280, LOOK_MAX = 1568, LOOK_QUALITY = 0.8;

/** The size of that picture for one of `width` x `height`: ratio kept, never a short side under LOOK_MIN nor a long one
 *  over LOOK_MAX. */
export function lookSize(width: number, height: number): { width: number; height: number } {
  const long = Math.max(width, height), short = Math.min(width, height);
  if (!long || !short) return { width: LOOK, height: LOOK };
  let k = Math.min(1, LOOK / long);
  if (short * k < LOOK_MIN) k = Math.min(LOOK_MIN / short, LOOK_MAX / long);
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

const two = (n: number) => String(n).padStart(2, "0");

/** `YYYYMMDD-HHMMSS.jpg`, local time; `-2`, `-3` (as newNotePath does) when the note has that one already. */
export function photoName(at: number, taken: ReadonlySet<string>): string {
  const d = new Date(at);
  const stem = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
  let n = `${stem}.jpg`;
  for (let i = 2; taken.has(n); i++) n = `${stem}-${i}.jpg`;
  return n;
}

/** What a body's image line points at, after `../`. */
export const linkPath = (noteId: string, name: string) => `${ATTACHMENTS}${noteId}/${name}`;

/** The body's lines for these photos, one image each. */
export const photoMarkdown = (noteId: string, names: string[]) => names.map((name) => `![](../${linkPath(noteId, name)})`).join("\n");

// ---- PDFs

export const PDF = "application/pdf";
/** What the server takes (server/pb_migrations/1792500000_pdf.js). */
export const MAX_PDF = 25 * 1024 * 1024;

export const isPdf = (name: string) => /\.pdf$/i.test(name);

/** A PDF's name as the note stores it: its slug as a note id's is made (ASCII, lowercase, dashes, Greek transliterated)
 *  and `.pdf`, so it is safe in a link, a path on the phone and a URL; `-2`, `-3` when the note has that one already.
 *  The original name stays as the link's text. */
export function pdfName(original: string, taken: ReadonlySet<string>): string {
  const base = original.replace(/\.pdf$/i, ""), stem = /[\p{L}\p{N}]/u.test(base) ? slugify(base) : "document";
  let n = `${stem}.pdf`;
  for (let i = 2; taken.has(n); i++) n = `${stem}-${i}.pdf`;
  return n;
}

/** The body's line for a PDF or a drawing: a link to it, its original name as the text. A drawing's PNG preview is never linked. */
export const fileMarkdown = (noteId: string, name: string, label: string) =>
  `[${label.replace(/[[\]\\]/g, "\\$&")}](../${linkPath(noteId, name)})`;

/** The note and file a link points at, whatever it has become (`../attachments/<id>/<name>`, or the file:// copy the
 *  preview shows it as); null for any other link. */
export function attachmentLink(href: string): { noteId: string; name: string } | null {
  const m = /(?:^|\/)attachments\/([^/?#]+)\/([^/?#]+)$/.exec(href);
  if (!m) return null;
  try { return { noteId: decodeURIComponent(m[1]), name: decodeURIComponent(m[2]) }; } catch { return { noteId: m[1], name: m[2] }; }
}

// ---- Drawings

export const DRAWING = "application/json";
const DRAWING_EXT = /\.excalidraw$/i;

export const isDrawing = (name: string) => DRAWING_EXT.test(name);
/** A drawing's file name as a tool, a widget or the assistant's context names one: a single path segment, `.excalidraw`. */
export const isDrawingName = (v: unknown): v is string => typeof v === "string" && v.length <= 200 && isDrawing(v) && !/[/\\]/.test(v);

/** A drawing's name as the note stores it (`<slug>.excalidraw`, `-2`, `-3` when taken); the label stays as the link's text.
 *  Its preview is `drawingPreview(name)`, so neither name may be taken. */
export function drawingName(label: string, taken: ReadonlySet<string>): string {
  const stem = /[\p{L}\p{N}]/u.test(label) ? slugify(label) : "drawing";
  let n = `${stem}.excalidraw`;
  for (let i = 2; taken.has(n) || taken.has(drawingPreview(n)); i++) n = `${stem}-${i}.excalidraw`;
  return n;
}

/** The PNG kept beside a drawing, which the chip and the phone's viewer show: the drawing's name with `.png`. */
export const drawingPreview = (name: string) => name.replace(DRAWING_EXT, ".png");
