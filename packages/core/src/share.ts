// What Android's Share sheet hands over — a link, clipped text, photos, PDFs — shaped for the two things the app does
// with it: save it as a note as it is, or hand it to the agent to file. Pure: the intent's parsing and the
// text it becomes are tested in packages/core/test/share.test.ts; the writing is mobile/src/store/share.ts.
import type { ClipPage, Target } from "./clip";
import { inheritTags, type Lens } from "./lens";
import { firstUrl, linkify } from "./links";
import { isPdf, PDF } from "./photos";
import { localDay } from "./time";

export type SharedImage = { uri: string; width: number | null; height: number | null };
export type SharedPdf = { uri: string; name: string };
export type Shared = { text: string; url: string | null; images: SharedImage[]; pdfs: SharedPdf[]; title: string | null };

/** What the share module reports, the parts this app reads. */
type Intent = {
  text?: string | null;
  webUrl?: string | null;
  files?: { path: string; mimeType: string; fileName?: string | null; width: number | null; height: number | null }[] | null;
  meta?: { title?: string } | null;
};

/** The intent as a Shared: images and PDFs only (a video has nowhere to go in a note), the text without the
 *  URL when that's all it was. null when nothing usable was shared. */
export function fromIntent(i: Intent): Shared | null {
  const images = (i.files ?? []).filter((f) => f.mimeType.startsWith("image/")).map((f) => ({ uri: f.path, width: f.width, height: f.height }));
  const pdfs = (i.files ?? []).filter((f) => f.mimeType === PDF).map((f) => ({ uri: f.path, name: f.fileName || decodeURIComponent(f.path.slice(f.path.lastIndexOf("/") + 1)) }));
  const url = i.webUrl?.trim() || null;
  let text = (i.text ?? "").trim();
  if (url && text === url) text = "";
  if (!text && !url && !images.length && !pdfs.length) return null;
  return { text, url, images, pdfs, title: i.meta?.title?.trim() || null };
}

const isUrl = (s: string) => /^https?:\/\/\S+$/.test(s);

/** What the web app's share target received as a Shared (the phone's `fromIntent`, for a form). Android puts the link in
 *  `text` (after the page's title, or with some words of the app's), sometimes in `title`, rarely in `url`: the first one
 *  found is the link, and text that says no more than the link and the title is dropped. Images and PDFs only; a file's
 *  `uri` is its place in `files`, the page's own copy of the bytes. null when nothing usable was shared. */
export function fromPost(p: { title: string; text: string; url: string; files: readonly { name: string; type: string }[] }): Shared | null {
  const title = p.title.trim(), url = [p.url.trim(), p.text, p.title].map((s) => (isUrl(s.trim()) ? s.trim() : firstUrl(s))).find(Boolean) ?? null;
  let text = p.text.trim();
  if (url && text.replace(url, "").trim() === (isUrl(title) ? "" : title)) text = "";
  const images: SharedImage[] = [], pdfs: SharedPdf[] = [];
  p.files.forEach((f, i) => {
    if (f.type === PDF || isPdf(f.name)) pdfs.push({ uri: String(i), name: f.name });
    else if (f.type.startsWith("image/")) images.push({ uri: String(i), width: null, height: null });
  });
  if (!text && !url && !images.length && !pdfs.length) return null;
  return { text, url, images, pdfs, title: title && !isUrl(title) ? title : null };
}

/** Something typed or pasted into the share page's box, as a share. */
export const fromPasted = (text: string): Shared | null => fromPost({ title: "", text, url: "", files: [] });

/** The tags a clip carries, the owner's: a new note or task takes the lens's first tag (what the app makes under a lens
 *  does), an existing one is left as it is. */
export const clipTags = (target: Target, lens: Lens | null | undefined): string[] =>
  target.kind === "new" || target.kind === "newtask" ? inheritTags(lens) : [];

/** The share as a clip for the server's clip routes (core/clip.ts): its link, the page's title, the text as the selection,
 *  one photo as the picture (its bytes are the store's). null when the clip routes can't take it: a PDF, or several
 *  photos, which only a note of its own holds. */
export function clipOf(s: Shared, pageTitle: string | null): ClipPage | null {
  if (s.pdfs.length || s.images.length > 1) return null;
  return {
    url: s.url ?? "",
    title: pageTitle?.trim() || s.title || "",
    ...(s.text && { selection: s.text }),
    ...(s.images.length && { image: { src: "" } }),
  };
}

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const firstLine = (t: string) => t.split("\n").map((l) => l.trim()).find(Boolean) ?? "";

/** A title to save it under: the page's, else the text's first line (cut short), else the site, else a PDF's name, else the day. */
export function titleFor(s: Shared, pageTitle: string | null): string {
  const t = pageTitle?.trim() || s.title || firstLine(s.text);
  if (t) return t.length > 60 ? `${t.slice(0, 57).trimEnd()}…` : t;
  if (s.url) return host(s.url);
  if (s.pdfs.length) return s.pdfs[0].name.replace(/\.pdf$/i, "");
  return `Photos ${localDay()}`;
}

/** The body: the link as [title](url) — in the text where it was pasted, else on a line of its own above
 *  the text — then the text as it came. Photos and PDFs are attached after, by the store. */
export function bodyFor(s: Shared, pageTitle: string | null): string {
  const label = pageTitle?.trim() || s.title || "";
  let body = s.text;
  if (s.url) {
    const link = label ? `[${label.replace(/[[\]\\]/g, "\\$&")}](${s.url})` : `<${s.url}>`;
    body = body.includes(s.url) ? (label ? linkify(body, s.url, label) : body.replace(s.url, link)) : [link, body].filter(Boolean).join("\n\n");
  }
  return body ? `${body.trimEnd()}\n` : "";
}

const ENTITY: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const attr = (v: string) => v.replace(/[&<>"]/g, (c) => ENTITY[c]);
const unattr = (v: string) => v.replace(/&(amp|lt|gt|quot);/g, (e) => Object.keys(ENTITY).find((c) => ENTITY[c] === e) ?? e);

/** The message the agent gets: the share in a `<shared>` block it's told to file (systemPrompt.ts), with the
 *  page's title when one was found, and the note the photos and PDFs went into when there were any. */
export function askText(s: Shared, pageTitle: string | null, filesAt?: string): string {
  const parts: string[] = [];
  const title = pageTitle?.trim() || s.title;
  if (s.url) parts.push(`<url${title ? ` title="${attr(title)}"` : ""}>${s.url}</url>`);
  if (s.text) parts.push(`<text>\n${s.text}\n</text>`);
  if (filesAt) parts.push(`<files note="${filesAt}" photos="${s.images.length}" pdfs="${s.pdfs.length}" />`);
  return `<shared>\n${parts.join("\n")}\n</shared>\nFile this in my notes.`;
}

const count = (n: string, what: string) => (n === "0" ? "" : `${n} ${what}${n === "1" ? "" : "s"}`);

/** A `<shared>` message as the chat shows it to the user: the tags off, "Shared:" on top. */
export function plainShared(text: string): string {
  if (!text.startsWith("<shared>")) return text;
  const inner = text
    .replace(/<\/?shared>|<\/?text>\n?/g, "")
    .replace(/<url(?: title="([^"]*)")?>(.*?)<\/url>/g, (_, t: string | undefined, u: string) => (t ? `${unattr(t)}\n${u}` : u))
    .replace(/<files note="[^"]*" photos="(\d+)" pdfs="(\d+)" \/>/g, (_, p: string, d: string) => [count(p, "photo"), count(d, "PDF")].filter(Boolean).join(", "))
    .replace(/\n?File this in my notes\.$/, "")
    .trim();
  return `Shared:\n${inner}`;
}

/** What a chat is called in the history: a typed first question as it is (one line), a share as "Shared:" and what it
 *  was: the page's title, else the site, else the text's first line, else what files came with it. */
export function chatTitle(text: string): string {
  const one = (t: string) => t.replace(/\s+/g, " ").trim();
  if (!text.startsWith("<shared>")) return one(text);
  const what = firstLine(plainShared(text).replace(/^Shared:\n/, ""));
  return what ? `Shared: ${/^https?:\/\/\S+$/.test(what) ? host(what) : one(what)}` : "Shared";
}
