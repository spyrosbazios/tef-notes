// The buttons beside a link (./link-read) and on a link's card (./link-cards). Copy: the URL. Read: the page as an article, in the app.
// Summary: the server writes a summary of the page
// (server/pb_hooks/summary.pb.js) and it goes in as the block right under the link's paragraph, the place a clip with
// "Add a summary" puts it. A link already followed by one gets no button. The insert is an ordinary edit (`onChange`).
import type { Node } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { parse, schema } from "./markdown";

/** The summary block of the page at `url`, as markdown (a blockquote under a bold "Summary"). Rejects with the reason. */
export type Summarize = (url: string) => Promise<string>;

/** The position just after the top-level block holding `pos` (`pos` itself when it is between blocks). */
const blockEnd = (doc: Node, pos: number) => {
  const $p = doc.resolve(pos);
  return $p.depth ? $p.after(1) : pos;
};

/** The Read button: a lucide book-open (index.css `[data-icon]`) and "Read"; a click hands the URL to `read`. */
export function readButton(cls: string, href: string, read: (url: string) => void): HTMLElement {
  const btn = document.createElement("button");
  btn.className = cls;
  btn.type = "button";
  btn.contentEditable = "false";
  btn.dataset.icon = "read";
  btn.title = "Reader view: the page as an article";
  btn.textContent = "Read";
  btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); read(href); });
  btn.addEventListener("keydown", (e) => e.stopPropagation());
  return btn;
}

/** The Copy button: a lucide copy icon and "Copy"; a click puts the URL on the clipboard. The phone's editor is a file://
 *  page, where `navigator.clipboard` can be missing or refuse: a selected textarea and the copy command there. */
export function copyButton(cls: string, href: string): HTMLElement {
  const btn = document.createElement("button");
  btn.className = cls;
  btn.type = "button";
  btn.contentEditable = "false";
  btn.dataset.icon = "copy";
  btn.title = "Copy the link";
  btn.textContent = "Copy";
  const shown = (text: string) => { btn.textContent = text; setTimeout(() => { btn.textContent = "Copy"; }, 1500); };
  const fallback = () => {
    const area = document.createElement("textarea");
    area.value = href;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    shown(ok ? "Copied" : "Copy failed");
  };
  btn.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(href).then(() => shown("Copied"), fallback);
    else fallback();
  });
  btn.addEventListener("keydown", (e) => e.stopPropagation());
  return btn;
}

/** Whether the block after the one holding `pos` is a summary: a blockquote whose first line is "Summary". (Its first
 *  child's text, not the quote's: `textContent` runs the blocks together, "SummaryKokonut…", and `\b` never matches.) */
export function summarised(doc: Node, pos: number): boolean {
  const next = doc.resolve(blockEnd(doc, pos)).nodeAfter;
  return next?.type === schema.nodes.blockquote && /^\s*summary\b/i.test(next.firstChild?.textContent ?? "");
}

/** A sparkles icon and "Summary": a click asks `summarize` and puts the block under the link at `getPos`. */
export function summaryButton(cls: string, href: string, view: EditorView, getPos: () => number | undefined, summarize: Summarize): HTMLElement {
  const btn = document.createElement("button");
  btn.className = cls;
  btn.type = "button";
  btn.contentEditable = "false";
  btn.dataset.icon = "summary";
  btn.title = "Write an AI summary of the page under the link";
  btn.textContent = "Summary";
  btn.addEventListener("keydown", (e) => e.stopPropagation());
  btn.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    if (btn.disabled) return;
    btn.disabled = true;
    btn.dataset.busy = "";
    btn.textContent = "Summarising…";
    summarize(href).then((block) => {
      // The button never stays busy: the redraw that drops it can lag the insert, or not come at all (link moved, gone).
      delete btn.dataset.busy;
      btn.textContent = "Summary added";
      const pos = getPos();
      if (view.isDestroyed || pos === undefined || summarised(view.state.doc, pos)) return;
      const at = blockEnd(view.state.doc, pos);
      view.dispatch(view.state.tr.insert(at, parse(block).content).scrollIntoView());
    }, (err: unknown) => {
      btn.disabled = false;
      delete btn.dataset.busy;
      btn.textContent = "Summary failed, retry";
      btn.title = err instanceof Error ? err.message : "The summary couldn't be written.";
    });
  });
  return btn;
}
