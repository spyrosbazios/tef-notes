// What Android's Share sheet hands the installed web app — a link, clipped text, photos, PDFs — shaped for the two things
// the app does with it: save it as a note as it is, or hand it to the agent to file. Pure: the form's parsing and the
// text it becomes are tested in packages/core/test/share.test.ts; the page is web/src/components/share-page.tsx.
import type { ClipPage } from "./clip";
import { askedAbout } from "./handoff";
import { firstUrl, hostOf, linkify } from "./hyperlinks";
import { isPdf, PDF } from "./photos";

type SharedImage = { uri: string; width: number | null; height: number | null };
type SharedPdf = { uri: string; name: string };
export type Shared = { text: string; url: string | null; images: SharedImage[]; pdfs: SharedPdf[]; title: string | null };

const isUrl = (s: string) => /^https?:\/\/\S+$/.test(s);

/** What the web app's share target received, as a Shared. Android puts the link in
 *  `text` (after the page's title, or with some words of the app's), sometimes in `title`, rarely in `url`: the first one
 *  found is the link, and text that says no more than the link and the title is dropped. Images and PDFs only; a file's
 *  `uri` is its place in `files`, the page's own copy of the bytes. null when nothing usable was shared. */
export function fromPost(p: { title: string; text: string; url: string; files: readonly { name: string; type: string }[] }): Shared | null {
  const title = p.title.trim(), url = [p.url.trim(), p.text, p.title].map((s) => (isUrl(s.trim()) ? s.trim() : firstUrl(s))).find(Boolean) ?? null;
  let text = p.text.trim();
  const rest = url ? text.replace(url, "").trim() : text;
  if (url && (!rest || rest === title)) text = "";
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

/** The share as a clip for the server's clip routes (core/clip.ts): its link, the page's title, the text as the selection,
 *  its photos and PDFs as the clip's files (their bytes are the store's, in the share's order: photos, then PDFs). */
export function clipOf(s: Shared, pageTitle: string | null): ClipPage {
  return {
    url: s.url ?? "",
    title: pageTitle?.trim() || s.title || "",
    ...(s.text && { selection: s.text }),
    ...(s.images.length && { images: s.images.map(() => ({ src: "" })) }),
    ...(s.pdfs.length && { pdfs: s.pdfs.map((p) => ({ name: p.name })) }),
  };
}

const host = (u: string) => hostOf(u) ?? u;
const firstLine = (t: string) => t.split("\n").map((l) => l.trim()).find(Boolean) ?? "";

/** A title is at most this long; a longer one is cut with an ellipsis. */
export const TITLE_MAX = 60;
const cut = (t: string) => (t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 3).trimEnd()}…` : t);

/** A title a model wrote for a shared photo or PDF (server/agent/src/title.ts), made fit to save: its first line, without
 *  a "Title:" label, markdown, quotes or a closing full stop, at most TITLE_MAX. "" when nothing is left. */
export function cleanTitle(raw: string): string {
  const t = firstLine(raw)
    .replace(/^title\s*:\s*/i, "")
    .replace(/^[#*_>\s-]+|[*_]+$/g, "")
    .replace(/["“”«»„`]/g, "")
    .replace(/^'+|'+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "")
    .trim();
  return cut(t);
}

/** A title to save it under: the page's, else the text's first line (cut short), else the site, else a PDF's name, else `today`'s photos. */
export function titleFor(s: Shared, pageTitle: string | null, today: string): string {
  const t = pageTitle?.trim() || s.title || firstLine(s.text);
  if (t) return cut(t);
  if (s.url) return host(s.url);
  if (s.pdfs.length) return s.pdfs[0].name.replace(/\.pdf$/i, "");
  return `Photos ${today}`;
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

/** What a chat is called in the history: a typed first question as it is (one line; one about notes by its words, else
 *  their titles), a share as "Shared:" and what it
 *  was: the page's title, else the site, else the text's first line, else what files came with it. */
export function chatTitle(text: string): string {
  const one = (t: string) => t.replace(/\s+/g, " ").trim();
  const about = askedAbout(text);
  if (about.notes.length) return one(about.rest) || one(about.notes.map((n) => n.title).join(", "));
  if (!text.startsWith("<shared>")) return one(text);
  const what = firstLine(plainShared(text).replace(/^Shared:\n/, ""));
  return what ? `Shared: ${/^https?:\/\/\S+$/.test(what) ? host(what) : one(what)}` : "Shared";
}
