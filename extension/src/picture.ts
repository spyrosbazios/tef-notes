// A picture's bytes, and the two JPEGs made from them on a canvas: the one stored in the note, downscaled as the web app
// downscales a photo (packages/core/src/photos.ts: long edge 1600, JPEG 0.82), and the smaller one JEV looks at
// (TypeSafe takes 280 to 1568 px a side: long edge 768, padded up to 280).
//
// Where the bytes come from: the extension fetches the picture itself, with the browser's session for that site when
// the owner has let it reach that site (or when the site lets anyone read it); else the server fetches it, which works
// for a public picture only (its SSRF guard, server/pb_hooks/lib/link-preview.js). When both fail the popup offers to
// ask Chrome for access to the picture's site (needs the click's user gesture) and tries again.
import { fit, LOOK, LOOK_MIN, LOOK_QUALITY, MAX, QUALITY } from "@/core/photos";
import { C } from "@/core/theme";
import { pictureViaServer } from "./clip";

const FETCH_MS = 20_000;

/** Neither the extension nor the server could get the picture: `origin` is the site Chrome could let it reach. */
export class PictureError extends Error {
  constructor(message: string, readonly origin?: string) {
    super(message);
  }
}

export type Picture = { stored: Blob; look: string; preview: string };

const originOf = (src: string) => { try { const u = new URL(src); return /^https?:$/.test(u.protocol) ? u.origin : undefined; } catch { return undefined; } };

/** Chrome's access to the picture's site, asked for in a click (nothing may be awaited before it). */
export const allow = (origin: string) => chrome.permissions.request({ origins: [`${origin}/*`] });

async function bytes(src: string): Promise<Blob> {
  try {
    const res = await fetch(src, { credentials: "include", signal: AbortSignal.timeout(FETCH_MS) });
    if (res.ok) return await res.blob();
  } catch {
    // CORS without access to the site, or the site didn't answer: the server tries
  }
  const origin = originOf(src);
  if (!origin) throw new PictureError("This picture can't be read.");
  try {
    return await pictureViaServer(src);
  } catch (e) {
    const granted = await chrome.permissions.contains({ origins: [`${origin}/*`] });
    throw new PictureError(e instanceof Error ? e.message : "The picture could not be fetched.", granted ? undefined : origin);
  }
}

/** The picture drawn at `w` x `h` on a canvas of at least `minW` x `minH` (centred), as a JPEG. Transparency becomes the
 *  palette's light foreground: a web page's transparent picture is drawn for a light page. */
function jpeg(img: HTMLImageElement, w: number, h: number, quality: number, minW = 0, minH = 0): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(w, minW);
  canvas.height = Math.max(h, minH);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PictureError("This picture can't be read.");
  ctx.fillStyle = C.fg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, Math.round((canvas.width - w) / 2), Math.round((canvas.height - h) / 2), w, h);
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new PictureError("This picture can't be read."))), "image/jpeg", quality));
}

/** `w` x `h` scaled so the long edge is at most `max`. */
function scaled(w: number, h: number, max: number): [number, number] {
  const s = fit(w, h, max);
  if (!s) return [w, h];
  return "width" in s ? [max, Math.max(1, Math.round((h * max) / w))] : [Math.max(1, Math.round((w * max) / h)), max];
}

const base64 = (b: Blob) => new Promise<string>((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""));
  r.onerror = () => fail(new PictureError("This picture can't be read."));
  r.readAsDataURL(b);
});

/** The picture at `src`: the JPEG to store, the one JEV sees (base64), and an object URL of the stored one to show. */
export async function picture(src: string): Promise<Picture> {
  const blob = await bytes(src), url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => { throw new PictureError("This picture can't be read."); });
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) throw new PictureError("This picture can't be read.");
    const stored = await jpeg(img, ...scaled(w, h, MAX), QUALITY);
    const look = await base64(await jpeg(img, ...scaled(w, h, LOOK), LOOK_QUALITY, LOOK_MIN, LOOK_MIN));
    return { stored, look, preview: URL.createObjectURL(stored) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
