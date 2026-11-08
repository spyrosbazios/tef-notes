// A WYSIWYG markdown editor in plain DOM: `createEditor(element, { markdown, onChange })`. It edits a note's body
// (the frontmatter is the caller's) and hands back the body as markdown. Nothing here knows React, the page, or
// the server, so the same module can sit in an Android WebView. The note format lives in ./markdown, the keys and
// shortcuts in ./commands, the node views in ./views.
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import { history } from "prosemirror-history";
import { Fragment, Slice } from "prosemirror-model";
import type { Node } from "prosemirror-model";
import { EditorState, Plugin, Selection } from "prosemirror-state";
import { cellAround, tableEditing } from "prosemirror-tables";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import { base, commands, isActive, keys, linkAt, setLink, typed } from "./commands";
import type { CommandName } from "./commands";
import { chipHref, drawingPreviewSrc, fileChips, isDrawingLink, type PdfPage, type PdfPages } from "./files";
import { normalizeBody, parse, schema, serialize } from "./markdown";
import { linkCards } from "./link-cards";
import type { ResolveLink } from "./link-cards";
import { readLinks } from "./link-read";
import type { Summarize } from "./link-tools";
import { ImageView, ListItemView } from "./views";
import { spliced } from "@/core/voice";
import type { ResolveImage } from "./views";

export { normalizeBody };
export { drawingPreviewSrc, isDrawingLink } from "./files";
export type { CommandName, PdfPage, PdfPages, ResolveImage, ResolveLink, Summarize };

/** A picture the note shows, for the viewer: an image, or a drawing's preview. `src` is the file's own path (`../attachments/<id>/<name>`). */
export type GalleryItem = { src: string; alt: string };

export type EditorOptions = {
  /** The body to open with. Opening never calls `onChange`. */
  markdown: string;
  /** The body as markdown after each edit the user makes (not after `setMarkdown`), and only when it changed. */
  onChange: (markdown: string) => void;
  /** The URL to show for an image's `src` (a note's `../attachments/<id>/<name>.jpg`); null: not available, a placeholder shows. Default: `src` itself. */
  resolveImage?: ResolveImage;
  /** The picture of a PDF link's first page, shown above its chip. Without it a PDF is only its chip. */
  pdfPage?: PdfPage;
  /** How many pages a PDF link's file has, shown on its first page. */
  pdfPages?: PdfPages;
  /** Files (images, PDFs) pasted or dropped. The caller stores them, then `insertMarkdown`s the lines that show them. */
  onFiles?: (files: File[]) => void;
  /** A PDF or drawing chip tapped or clicked: the link's href (`../attachments/<id>/<name>.pdf`, `.excalidraw`). The caller opens the file. */
  onFile?: (href: string) => void;
  /** A photo (or a drawing's thumbnail) tapped or clicked: its `src`, and its place among the note's pictures (`gallery()`). The caller opens a viewer. */
  onImage?: (src: string, index: number) => void;
  /** A link opened with Ctrl or Cmd held, or a link card clicked. Return true when handled; otherwise the link opens in a new tab. */
  onLink?: (href: string) => boolean;
  /** A link's Reader view button clicked: the page's URL. Every http(s) link in the note gets one (./link-read); the
   *  card under a paragraph that is only a URL gets its own. Without it there are no such buttons. */
  onRead?: (url: string) => void;
  /** A link's Summary button clicked: the page's summary block, which the editor puts under the link (./link-tools). Without
   *  it there are no such buttons. */
  summarize?: Summarize;
  /** The preview of a URL, for the card under a paragraph that is only that URL. Without it there are no cards. */
  resolveLink?: ResolveLink;
  /** A YouTube link on a line of its own plays in the note when clicked (default); false: the click opens the link. */
  inlineVideo?: boolean;
  placeholder?: string;
};

export type Editor = {
  /** The body now, as markdown. */
  markdown(): string;
  /** Replace the body with one that came from elsewhere (another device, a settled conflict). Not an edit: no `onChange`. */
  setMarkdown(markdown: string): void;
  /** Insert markdown at the cursor (the end, if the editor was never touched). */
  insertMarkdown(markdown: string): void;
  /** Insert plain text at the cursor (the end, if never touched), spaced from a word before it: what dictation types. */
  insertText(text: string): void;
  focus(at?: "start" | "end"): void;
  setResolveImage(resolve: ResolveImage): void;
  /** Every picture the note shows, in order: its images and the previews of its drawings. */
  gallery(): GalleryItem[];
  /** A toolbar or shortcut action. `link` takes an href, or none to take the link off. False when it doesn't apply here. */
  run(name: CommandName, arg?: string): boolean;
  isActive(name: CommandName): boolean;
  inTable(): boolean;
  /** The cursor is in a list item that has a neighbour to swap with (`moveUp`, `moveDown`). */
  canMove(): boolean;
  /** The href of the link under the cursor. */
  linkHref(): string | null;
  /** Called after every state change (edit or cursor move): redraw what depends on `isActive`. */
  subscribe(listener: () => void): () => void;
  destroy(): void;
};

const EXTERNAL = "tefnotes-external";

/** Grey hint in an empty note. */
function placeholder(text: string) {
  return new Plugin({
    props: {
      decorations: (state) => {
        const { doc } = state, only = doc.firstChild;
        return doc.childCount === 1 && only?.type === schema.nodes.paragraph && only.content.size === 0
          ? DecorationSet.create(doc, [Decoration.node(0, only.nodeSize, { class: "is-empty", "data-placeholder": text })])
          : null;
      },
    },
  });
}

/** The note always ends on a paragraph, so there is somewhere to type after a table, a rule or a code block. */
const trailingParagraph = new Plugin({
  appendTransaction: (_trs, _old, state) => {
    const last = state.doc.lastChild;
    return last?.type === schema.nodes.paragraph ? null : state.tr.insert(state.doc.content.size, schema.nodes.paragraph.create());
  },
});

/** Pasted plain text is markdown: a pasted list is a list. A lone paragraph merges into the text at the cursor. */
function textSlice(text: string): Slice {
  const doc = parse(text);
  return doc.childCount === 1 && doc.firstChild?.type === schema.nodes.paragraph
    ? new Slice(Fragment.from(doc.firstChild), 1, 1)
    : new Slice(doc.content, 0, 0);
}

export function createEditor(el: HTMLElement, options: EditorOptions): Editor {
  let resolve: ResolveImage = options.resolveImage ?? ((src) => src);
  let last = "", touched = false;
  const images = new Set<ImageView>(), listeners = new Set<() => void>();

  /** The note's pictures in order, from the document: what a tap on one pages through. */
  const gallery = (doc: Node): GalleryItem[] => {
    const out: GalleryItem[] = [];
    doc.descendants((n) => {
      if (n.type === schema.nodes.image) out.push({ src: n.attrs.src, alt: n.attrs.alt ?? "" });
      else if (n.isText) {
        const href = schema.marks.link.isInSet(n.marks)?.attrs.href;
        if (href && isDrawingLink(href) && !out.some((i) => i.src === drawingPreviewSrc(href))) out.push({ src: drawingPreviewSrc(href), alt: n.text ?? "" });
      }
    });
    return out;
  };

  const open = (href: string) => { if (!options.onLink?.(href)) window.open(href, "_blank", "noopener,noreferrer"); };

  const stateFor = (doc: Node) => EditorState.create({
    doc,
    plugins: [
      history(), typed, keys, base, dropCursor({ color: false, width: 2 }), gapCursor(), tableEditing(),
      placeholder(options.placeholder ?? ""), trailingParagraph, fileChips(() => resolve, options.pdfPage, options.pdfPages),
      ...(options.onRead ? [readLinks(options.onRead, options.summarize)] : []),
      ...(options.resolveLink ? [linkCards(options.resolveLink, open, options.onRead, options.summarize, options.inlineVideo ?? true)] : []),
    ],
  });

  const view: EditorView = new EditorView(el, {
    state: stateFor(parse(options.markdown)),
    attributes: { class: "md pm-editor", spellcheck: "true", "aria-label": "Note body", role: "textbox", "aria-multiline": "true" },
    nodeViews: {
      image: (node) => new ImageView(node, () => resolve, images),
      list_item: (node, v, getPos) => new ListItemView(node, v, getPos),
    },
    dispatchTransaction(tr) {
      view.updateState(view.state.apply(tr));
      if (tr.docChanged && !tr.getMeta(EXTERNAL)) {
        const md = serialize(view.state.doc);
        if (md !== last) { last = md; options.onChange(md); }
      }
      listeners.forEach((l) => l());
    },
    handleDOMEvents: {
      focus: () => { touched = true; return false; },
      // A chip is a link's text: its click must not follow the href, which is no address
      click: (_v, e) => { if (chipHref(e.target)) e.preventDefault(); return false; },
    },
    handleClick(v, _pos, event) {
      const file = chipHref(event.target);
      if (file && options.onFile) { options.onFile(file); return true; }
      const src = (event.target as HTMLElement).closest<HTMLElement>(".pm-image img")?.dataset.src;
      if (src && options.onImage) { options.onImage(src, Math.max(0, gallery(v.state.doc).findIndex((i) => i.src === src))); return true; }
      const a = (event.target as HTMLElement).closest("a");
      const href = a?.getAttribute("href");
      if (!href || !(event.metaKey || event.ctrlKey)) return false;
      open(href);
      return true;
    },
    handlePaste(v, event) {
      const data = event.clipboardData;
      if (data?.files.length) { event.preventDefault(); options.onFiles?.([...data.files]); return true; }
      // A URL pasted over selected text links it
      const text = data?.getData("text/plain").trim() ?? "";
      if (!v.state.selection.empty && /^https?:\/\/\S+$/.test(text)) { setLink(text)(v.state, v.dispatch); return true; }
      return false;
    },
    handleDrop(v, event) {
      const files = [...(event.dataTransfer?.files ?? [])];
      if (!files.length) return false;
      event.preventDefault();
      event.stopPropagation();
      const at = v.posAtCoords({ left: event.clientX, top: event.clientY });
      if (at) v.dispatch(v.state.tr.setSelection(Selection.near(v.state.doc.resolve(at.pos))));
      options.onFiles?.(files);
      return true;
    },
    clipboardTextParser: (text) => textSlice(text),
    clipboardTextSerializer(slice) {
      const blocks = slice.content.firstChild?.isBlock ? slice.content : Fragment.from(schema.nodes.paragraph.create(null, slice.content));
      return serialize(schema.topNodeType.create(null, blocks)).replace(/\n$/, "");
    },
  });
  last = serialize(view.state.doc);

  return {
    markdown: () => serialize(view.state.doc),

    setMarkdown(markdown) {
      const doc = parse(markdown), next = serialize(doc);
      if (next === serialize(view.state.doc)) { last = next; return; }
      const at = view.state.selection.from;
      const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content).setMeta(EXTERNAL, true).setMeta("addToHistory", false);
      tr.setSelection(Selection.near(tr.doc.resolve(Math.min(at, tr.doc.content.size))));
      last = next;
      view.dispatch(tr);
    },

    insertMarkdown(markdown) {
      const doc = parse(markdown);
      if (!touched) view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));
      view.dispatch(view.state.tr.replaceSelection(new Slice(doc.content, 0, 0)).scrollIntoView());
    },

    insertText(text) {
      if (!text) return;
      if (!touched) view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));
      const { $from } = view.state.selection;
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc");
      view.dispatch(view.state.tr.insertText(spliced(before, text)).scrollIntoView());
      touched = true;
      view.focus();
    },

    focus(at) {
      if (at) view.dispatch(view.state.tr.setSelection(at === "start" ? Selection.atStart(view.state.doc) : Selection.atEnd(view.state.doc)));
      touched = true;
      view.focus();
    },

    setResolveImage(fn) {
      resolve = fn;
      images.forEach((v) => v.refresh());
      view.dispatch(view.state.tr.setMeta(EXTERNAL, true));     // a drawing's thumbnail follows the resolver: redraw the decorations
    },

    gallery: () => gallery(view.state.doc),

    run(name, arg) {
      const ok = name === "link" ? setLink(arg ?? null)(view.state, view.dispatch) : commands[name](view.state, view.dispatch, view);
      if (ok) view.focus();
      return ok;
    },
    isActive: (name) => isActive(view.state, name),
    inTable: () => cellAround(view.state.selection.$from) !== null,
    canMove: () => commands.moveUp(view.state) || commands.moveDown(view.state),
    linkHref: () => linkAt(view.state),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    destroy() { listeners.clear(); view.destroy(); },
  };
}
