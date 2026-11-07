// The editor inside the phone's WebView: the same `createEditor` the web app uses, driven by messages (the shapes
// are packages/core/src/editor-bridge.ts). The phone owns the note; this page shows its body, reports each edit, and
// draws photos from the file:// copies the phone says it has, and link cards from the previews the phone fetches.
import "virtual:tefnotes-theme.css";
import "./host.css";
import { EDITOR_COMMANDS, type FromEditor, type ToEditor } from "@/core/editor-bridge";
import { attachmentLink } from "@/core/photos";
import { pdfThumbUrl, type LinkPreview } from "@/core/pocketbase";
import { rewriteImagePaths } from "@/core/notes";
import { createEditor, drawingPreviewSrc, isDrawingLink, type Editor, type PdfPage, type PdfPages, type ResolveImage } from "@/editor";
import { applyPageTheme } from "@/page-theme";

declare global {
  interface Window { ReactNativeWebView?: { postMessage(data: string): void } }
}

const send = (m: FromEditor) => window.ReactNativeWebView?.postMessage(JSON.stringify(m));
const host = document.getElementById("editor")!;
const images = new Map<string, string>();     // a photo's name to the file:// URI of the copy on the phone
let editor: Editor | null = null, noteId = "", server: string | null = null, active = "";

/** `../attachments/<id>/<name>.jpg` to the phone's copy; null (a placeholder) until the phone has one. */
const resolveImage: ResolveImage = (src) => {
  if (!/(^|\/)attachments\//.test(src)) return src;
  const shown = rewriteImagePaths(src, noteId, (n) => images.get(n));
  return shown === src ? null : shown;
};

/** A PDF's first page, drawn by the server (the phone holds the file, but this page has no PDF renderer). */
const pdfPage: PdfPage = (href) => {
  const a = attachmentLink(href);
  return a && server ? pdfThumbUrl({ url: server }, a.noteId, a.name, "sharp") : null;
};

/** The viewer, opened at `src` among the note's pictures. */
function showImage(src: string) {
  const srcs = editor?.gallery().map((i) => i.src) ?? [src];
  send({ type: "image", src, index: Math.max(0, srcs.indexOf(src)), srcs });
}

/** The note bar's tools that are on at the cursor, told to the app when they change. */
function reportState(ed: Editor) {
  const movable = ed.canMove();
  const now = EDITOR_COMMANDS.filter((name) => (name === "moveUp" || name === "moveDown" ? movable : ed.isActive(name)));
  const key = now.join();
  if (key === active) return;
  active = key;
  send({ type: "state", active: now });
}

/** A link card's preview: the app fetches it (this page can't read another site), so ask and wait for the answer. */
const previews = new Map<string, { ok: (p: LinkPreview | null) => void; fail: () => void }[]>();
const resolveLink = (url: string) => new Promise<LinkPreview | null>((ok, fail) => {
  const waiting = previews.get(url);
  if (waiting) { waiting.push({ ok, fail }); return; }
  previews.set(url, [{ ok, fail }]);
  send({ type: "preview", url });
});

/** A link's summary: the app asks the server, so ask and wait for the answer. */
const summaries = new Map<string, { ok: (s: string) => void; fail: (e: Error) => void }[]>();
const summarize = (url: string) => new Promise<string>((ok, fail) => {
  const waiting = summaries.get(url);
  if (waiting) { waiting.push({ ok, fail }); return; }
  summaries.set(url, [{ ok, fail }]);
  send({ type: "summarize", url });
});

/** A PDF's page count: the app asks the server, so ask and wait for the answer. */
const counts = new Map<string, ((n: number | null) => void)[]>();
const pdfPages: PdfPages = (href) => new Promise((ok) => {
  const waiting = counts.get(href);
  if (waiting) { waiting.push(ok); return; }
  counts.set(href, [ok]);
  send({ type: "pages", href });
});

function receive(m: ToEditor) {
  if (m.type === "pages") {
    const waiting = counts.get(m.href) ?? [];
    counts.delete(m.href);
    for (const ok of waiting) ok(m.pages);
    return;
  }
  if (m.type === "summary") {
    const waiting = summaries.get(m.url) ?? [];
    summaries.delete(m.url);
    for (const w of waiting) if ("error" in m) w.fail(new Error(m.error)); else w.ok(m.summary);
    return;
  }
  if (m.type === "preview") {
    const waiting = previews.get(m.url) ?? [];
    previews.delete(m.url);
    for (const w of waiting) if (m.failed) w.fail(); else w.ok(m.preview);
    return;
  }
  if (m.type === "theme") {
    applyPageTheme(m.theme);
    return;
  }
  if (m.type === "image") {
    images.set(m.name, m.uri);
    editor?.setResolveImage(resolveImage);
    return;
  }
  if (m.type === "command") {
    editor?.run(m.name, m.arg);
    return;
  }
  if (m.type === "insert") {
    editor?.insertMarkdown(m.markdown);
    return;
  }
  noteId = m.noteId;
  server = m.server;
  applyPageTheme(m.theme);
  for (const [name, uri] of Object.entries(m.images)) images.set(name, uri);
  if (editor) {
    editor.setMarkdown(m.markdown);
    editor.setResolveImage(resolveImage);
  } else {
    editor = createEditor(host, { markdown: m.markdown, onChange: (markdown) => send({ type: "change", markdown }), resolveImage, resolveLink, pdfPage, pdfPages,
      onFile: (href) => { if (isDrawingLink(href)) showImage(drawingPreviewSrc(href)); else send({ type: "file", href }); },   // a drawing is only looked at on the phone
      onImage: (src) => showImage(src),
      onLink: (href) => { send({ type: "link", href }); return true; },
      onRead: (href) => send({ type: "read", href }), summarize, inlineVideo: false, placeholder: m.placeholder });
    const ed = editor;
    ed.subscribe(() => reportState(ed));
  }
  reportState(editor);
}

// Android's WebView dispatches postMessage on `document`
document.addEventListener("message", (e) => receive(JSON.parse((e as MessageEvent<string>).data) as ToEditor));
send({ type: "ready" });
