// Where things are on the notes server: its address out of whatever was pasted, and the addresses of a photo, a tile's
// thumb, a link preview's picture and the agent's routes. Addresses only; the requests are client/pocketbase.ts's (or a
// client's own transport).
import type { LinkPreview } from "./hyperlinks";
import type { Photo } from "./photos";

export type Server = { url: string };                      // https://host[:port], no trailing slash

/** A tile picture's two sizes, PocketBase thumbs (declared on the fields in pb_migrations/1794200000_thumbs.js) and the
 *  agent's PDF pages alike: `blur` a few hundred bytes, shown blurred at once; `sharp` the one that fades in over it. */
export type ThumbSize = "blur" | "sharp";
const THUMB_SIZES: Record<ThumbSize, string> = { blur: "32x32f", sharp: "640x640f" };

/** `https://host:port` out of whatever was pasted: a trailing slash, `/_/`, `/api`, a missing scheme. */
export const serverUrl = (s: string) => {
  const t = s.trim().replace(/\/(_|api)?\/?$/, "").replace(/\/+$/, "");
  return !t || /^https?:\/\//.test(t) ? t : `https://${t}`;
};

/** Where a photo's bytes are. */
export const photoUrl = (s: Server, p: Pick<Photo, "rec" | "file">) => `${s.url}/api/files/attachments/${p.rec}/${encodeURIComponent(p.file)}`;

/** A photo at one of a tile's sizes, drawn and kept by the server. */
export const photoThumbUrl = (s: Server, p: Pick<Photo, "rec" | "file">, size: ThumbSize) => `${photoUrl(s, p)}?thumb=${THUMB_SIZES[size]}`;

/** A preview's picture at one of a tile's sizes from the server's copy; undefined when it kept none (the site's
 *  own address is no tile picture: it can't be blurred in, and it would be fetched from the site by every client). */
export const previewPictureUrl = (s: Server, p: Pick<LinkPreview, "picture"> | null | undefined, size: ThumbSize) =>
  p?.picture ? `${s.url}/api/files/link_previews/${p.picture}?thumb=${THUMB_SIZES[size]}` : undefined;

// The agent runs on the server (the sidecar under /agent, same origin): it holds the model keys, the tools and the prompt.
export const agentUrl = (s: Server, p: string) => `${s.url}/agent/${p}`;

/** A note's PDF's first page as a JPEG at one of a tile's sizes, rendered by the agent: a tile's picture. */
export const pdfThumbUrl = (s: Server, note: string, name: string, size: ThumbSize) =>
  agentUrl(s, `pdf-thumb?note=${encodeURIComponent(note)}&name=${encodeURIComponent(name)}&size=${size}`);
