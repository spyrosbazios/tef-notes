// A link to a PDF or a drawing attached to the note (`[name.pdf](../attachments/<id>/<name>.pdf)`, `[sketch](../attachments/<id>/<name>.excalidraw)`)
// drawn as a chip. The markdown is untouched: the link's own text is decorated, so the chip edits, copies and round-trips
// like any link, and a tap on it hands the href to the caller (which opens the file) instead of placing the cursor.
// A drawing's chip also carries a thumbnail, the PNG kept beside it, when the page can show it. A PDF's chip sits under
// its first page, the server's picture of it (`pdfPage`), shown full width so the note reads like the document, with
// its page count (`pdfPages`) on it once known.
import type { Mark, Node } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { attachmentLink, drawingPreview, isDrawing, isPdf } from "@/core/photos";
import { schema } from "./markdown";
import type { ResolveImage } from "./views";

export const FILE_CHIP = "file-chip", DRAWING_CHIP = "drawing-chip", DRAWING_THUMB = "drawing-thumb", PDF_PAGE = "pdf-page", PDF_COUNT = "pdf-count";

/** The picture of a PDF link's first page, by href; null when there is none to show (no server, not a note's PDF). */
export type PdfPage = (href: string) => string | null;
/** How many pages a PDF link's file has, by href; null when unknown. */
export type PdfPages = (href: string) => Promise<number | null>;

/** Whether `href` is a PDF in this note's attachments. */
export const isPdfLink = (href: string) => {
  const a = attachmentLink(href);
  return !!a && isPdf(a.name);
};

/** Whether `href` is a drawing in this note's attachments. */
export const isDrawingLink = (href: string) => {
  const a = attachmentLink(href);
  return !!a && isDrawing(a.name);
};

/** The picture of a drawing's link: the PNG beside it, as an image's `src` (so the page's resolver finds it). */
export const drawingPreviewSrc = (href: string) => drawingPreview(href);

const kindOf = (href: string) => (isPdfLink(href) ? FILE_CHIP : isDrawingLink(href) ? `${FILE_CHIP} ${DRAWING_CHIP}` : null);

/** The thumbnail before a drawing's chip: not editable, a click on it is a click on the chip. */
function thumb(url: string, href: string, label: string, className = DRAWING_THUMB) {
  const img = document.createElement("img");
  img.className = className;
  img.src = url;
  img.alt = label;
  img.draggable = false;
  img.contentEditable = "false";
  img.dataset.href = href;
  return img;
}

/** A PDF's first page, its page count on its corner once `count` answers. A page the server can't draw (yet) goes: just the chip. */
function page(url: string, href: string, label: string, count: Promise<number | null> | undefined) {
  const box = document.createElement("span");
  box.className = PDF_PAGE;
  box.contentEditable = "false";
  box.dataset.href = href;
  const img = thumb(url, href, label, "");
  img.onerror = () => box.remove();
  box.append(img);
  count?.then((n) => {
    if (!n) return;
    const tag = document.createElement("span");
    tag.className = PDF_COUNT;
    tag.textContent = n === 1 ? "1 page" : `${n} pages`;
    box.append(tag);
  }, () => {});
  return box;
}

/** One chip per run of text under the same PDF or drawing link, so a name with bold in it is still one chip. */
function chips(doc: Node, resolve: ResolveImage, pdfPage: PdfPage | undefined, counted: (href: string) => Promise<number | null> | undefined): DecorationSet {
  const out: Decoration[] = [];
  doc.descendants((block, at) => {
    if (!block.isTextblock) return true;
    let run: { mark: Mark; from: number; to: number } | null = null;
    const close = () => {
      if (run) {
        const href: string = run.mark.attrs.href, label = doc.textBetween(run.from, run.to);
        out.push(Decoration.inline(run.from, run.to, { class: kindOf(href) ?? FILE_CHIP, "data-href": href }));
        const url = isDrawingLink(href) ? resolve(drawingPreviewSrc(href)) : null;
        if (url) out.push(Decoration.widget(run.from, () => thumb(url, href, label), { side: -1, key: `${href}\n${url}`, ignoreSelection: true }));
        const first = isPdfLink(href) ? pdfPage?.(href) : null;
        if (first) out.push(Decoration.widget(run.from, () => page(first, href, label, counted(href)), { side: -1, key: `page\n${first}`, ignoreSelection: true }));
      }
      run = null;
    };
    block.forEach((child, offset) => {
      const mark = schema.marks.link.isInSet(child.marks);
      const from = at + 1 + offset;
      if (mark && kindOf(mark.attrs.href)) {
        if (run && run.mark.eq(mark)) run.to = from + child.nodeSize;
        else { close(); run = { mark, from, to: from + child.nodeSize }; }
      } else close();
    });
    close();
    return false;
  });
  return DecorationSet.create(doc, out);
}

/** The chips plugin; `resolve` is asked for a drawing's preview, `pdfPage` for a PDF's first page, each time the
 *  decorations are drawn; `pdfPages` once per PDF for as long as the editor lives (a stored file never changes). */
export function fileChips(resolve: () => ResolveImage, pdfPage?: PdfPage, pdfPages?: PdfPages) {
  const counts = new Map<string, Promise<number | null>>();
  const counted = (href: string) => {
    if (!pdfPages) return undefined;
    let n = counts.get(href);
    if (!n) { n = pdfPages(href); n.catch(() => counts.delete(href)); counts.set(href, n); }
    return n;
  };
  return new Plugin({ props: { decorations: (state) => chips(state.doc, resolve(), pdfPage, counted) } });
}

/** The PDF or drawing link a click (on its chip, thumbnail or page) landed on, as its href; null when it landed anywhere else. */
export const chipHref = (target: EventTarget | null) =>
  (target as HTMLElement | null)?.closest<HTMLElement>(`.${FILE_CHIP}, .${DRAWING_THUMB}, .${PDF_PAGE}`)?.dataset.href ?? null;
