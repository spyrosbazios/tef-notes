// Read (and Summary, ./link-tools) buttons after every link in a note's prose: the page read as an article, in the app (core/reader.ts).
// One button per link, however many a note holds. A paragraph that is only a URL is left to its card (./link-cards),
// whose own button sits below it, so a URL never gets two. The button is a widget decoration, not part of the document:
// the markdown, the cursor and a copy are untouched by it.
import type { Mark, Node } from "prosemirror-model";
import { hostOf } from "@/core/hyperlinks";
import { Decoration } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";
import { blockDecorations, eachTextblock } from "./incremental";
import { cardUrl } from "./link-cards";
import { schema } from "./markdown";
import { deleteButton, readButton, summarised, summaryButton, type Summarize } from "./link-tools";

/** Whether `href` is a page the reader can fetch: an http(s) address with a host. A note link and an attached file are relative
 *  (`notes/…`, `../attachments/…`), so the scheme tells a page from them; a link the owner left half typed (`[x](https://)`) has
 *  no host, and gets no button. */
export const readableLink = (href: string) => /^https?:\/\//i.test(href) && hostOf(href) !== null;

/** One run of text under the same readable link, with the position just after it (where the button goes). */
export type ReadableRun = { href: string; from: number; end: number };

/** The readable links of one text block, one run per link in order (a link split by a mark, bold inside it, is one). A
 *  top-level paragraph that is nothing but a URL has none: its card carries the button (cards are top-level only). */
function runsIn(block: Node, at: number, parent: Node): ReadableRun[] {
  const out: ReadableRun[] = [];
  if (parent.type === schema.nodes.doc && cardUrl(block)) return out;
  let run: { mark: Mark; from: number; to: number } | null = null;
  const close = () => {
    if (run && readableLink(run.mark.attrs.href)) out.push({ href: run.mark.attrs.href, from: run.from, end: run.to });
    run = null;
  };
  block.forEach((child, offset) => {
    const mark = schema.marks.link.isInSet(child.marks);
    const from = at + 1 + offset;
    if (mark && readableLink(mark.attrs.href)) {
      if (run && run.mark.eq(mark)) run.to = from + child.nodeSize;
      else { close(); run = { mark, from, to: from + child.nodeSize }; }
    } else close();
  });
  close();
  return out;
}

/** Every readable link in the document, one run per link in order. */
export function readableRuns(doc: Node): ReadableRun[] {
  const out: ReadableRun[] = [];
  eachTextblock(doc, 0, doc.content.size, (block, at, parent) => { out.push(...runsIn(block, at, parent)); });
  return out;
}

/** After a link: Read, Summary while the link has none under it, and Delete (the link's `length` characters before it). */
function buttons(href: string, length: number, read: (url: string) => void, view: EditorView, getPos: () => number | undefined, summarize?: Summarize): HTMLElement {
  const span = document.createElement("span");
  span.className = "pm-link-tools";
  span.contentEditable = "false";
  span.append(readButton("pm-link-tool", href, read));
  if (summarize) span.append(summaryButton("pm-link-tool", href, view, getPos, summarize));
  span.append(deleteButton("pm-link-tool", view, () => {
    const end = getPos();
    return end === undefined ? undefined : { from: end - length, to: end };
  }));
  return span;
}

/** The plugin; `read` gets the URL of the link whose Read was clicked, `summarize` writes its summary (no Summary without it).
 *  A link's Summary button goes once a summary sits under its top-level block, so an edit rereads the block before it too. */
export const readLinks = (read: (url: string) => void, summarize?: Summarize) =>
  blockDecorations((block, at, parent, doc) => runsIn(block, at, parent).map((r) => {
    const ask = summarize && !summarised(doc, r.end) ? summarize : undefined;
    return Decoration.widget(r.end, (view, getPos) => buttons(r.href, r.end - r.from, read, view, getPos, ask),
      { side: 1, key: `read:${r.href}:${r.end - r.from}:${ask ? 1 : 0}`, ignoreSelection: true, stopEvent: () => true });
  }), { behind: true });
