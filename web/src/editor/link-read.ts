// Read (and Summary, ./link-tools) buttons after every link in a note's prose: the page read as an article, in the app (core/reader.ts).
// One button per link, however many a note holds. A paragraph that is only a URL is left to its card (./link-cards),
// whose own button sits below it, so a URL never gets two. The button is a widget decoration, not part of the document:
// the markdown, the cursor and a copy are untouched by it.
import type { Mark, Node } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";
import { cardUrl } from "./link-cards";
import { schema } from "./markdown";
import { readButton, summarised, summaryButton, type Summarize } from "./link-tools";

/** Whether `href` is a page the reader can fetch: an http(s) address. A note link and an attached file are relative
 *  (`notes/…`, `../attachments/…`), so the scheme alone tells a page from them. */
export const readableLink = (href: string) => /^https?:\/\//i.test(href);

/** One run of text under the same readable link, with the position just after it (where the button goes). */
export type ReadableRun = { href: string; end: number };

/** Every readable link in the document, one run per link in order (a link split by a mark — bold inside it — is one).
 *  A paragraph that is nothing but a URL is skipped: its card carries the button. */
export function readableRuns(doc: Node): ReadableRun[] {
  const out: ReadableRun[] = [];
  doc.descendants((block, at, parent) => {
    if (!block.isTextblock) return true;
    if (parent === doc && cardUrl(block)) return false;   // its card carries the buttons (cards are top-level only)
    let run: { mark: Mark; from: number; to: number } | null = null;
    const close = () => {
      if (run && readableLink(run.mark.attrs.href)) out.push({ href: run.mark.attrs.href, end: run.to });
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
    return false;
  });
  return out;
}

/** After a link: Read, and Summary while the link has none under it. */
function buttons(href: string, read: (url: string) => void, view: EditorView, getPos: () => number | undefined, summarize?: Summarize): HTMLElement {
  const span = document.createElement("span");
  span.className = "pm-link-tools";
  span.contentEditable = "false";
  span.append(readButton("pm-link-tool", href, read));
  if (summarize) span.append(summaryButton("pm-link-tool", href, view, getPos, summarize));
  return span;
}

/** The plugin; `read` gets the URL of the link whose Read was clicked, `summarize` writes its summary (no Summary without it). */
export const readLinks = (read: (url: string) => void, summarize?: Summarize) =>
  new Plugin({
    props: {
      decorations(state) {
        const out = readableRuns(state.doc).map((r) => {
          const ask = summarize && !summarised(state.doc, r.end) ? summarize : undefined;
          return Decoration.widget(r.end, (view, getPos) => buttons(r.href, read, view, getPos, ask),
            { side: 1, key: `read:${r.end}:${ask ? 1 : 0}`, ignoreSelection: true, stopEvent: () => true });
        });
        return out.length ? DecorationSet.create(state.doc, out) : null;
      },
    },
  });
