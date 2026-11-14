// A paragraph that is only a URL (bare, or one labelled link) is drawn as a card, always (the URL alone until the page
// answers): picture, title, description, site, as Notion and Outline unfurl a pasted link. The card is a widget
// decoration, not a node: the note stays the one line of markdown it was, a `[text](url)` link inside a sentence stays a
// link, and delete the line and the card is gone.
// The line itself is hidden under its card, and shown again only to edit it: the caret on it, in the editor that has the
// focus. So the caret is kept off a line nobody is typing: a URL that arrives whole (pasted) sends it to the line after,
// and a note never ends on a card's line, where a tap under the card would land.
// Where the page's metadata comes from is the caller's (`resolve`): the server reads it (CORS keeps a browser out).
import type { Node } from "prosemirror-model";
import { isHistoryTransaction } from "prosemirror-history";
import { Plugin, TextSelection } from "prosemirror-state";
import type { EditorState, Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";
import type { LinkPreview } from "@/core/pocketbase";
import { youtubeEmbed, youtubeVideo } from "@/core/links";
import { isPdfLink } from "./files";
import { copyButton, deleteButton, readButton, summarised, summaryButton, type Summarize } from "./link-tools";

/** The preview of a URL. null: the page has nothing to show (no card). A rejection: it could not be asked (offline), so
 *  it is asked again later. */
export type ResolveLink = (url: string) => Promise<LinkPreview | null>;

const BARE = /^https?:\/\/[^\s<>]+$/;
const TYPING = 400;          // ms a URL under the cursor must sit still before it is looked up: not once per letter typed
const RETRY = 30_000;        // ms before a lookup that could not be made is made again

/** The URL a paragraph is by itself: its text, in plain text or linked as markdown wrote a bare URL, or one
 *  `[label](url)` link that is the whole paragraph (a clip's line), and nothing else (a word beside it, another mark,
 *  an image or a break make it prose). null otherwise. */
export function cardUrl(p: Node): string | null {
  if (p.type.name !== "paragraph" || !p.childCount) return null;
  let text = "";
  let href: string | null = null;
  for (let i = 0; i < p.childCount; i++) {
    const c = p.child(i);
    if (!c.isText) return null;
    if (!c.marks.length) { text += c.text; continue; }
    const m = c.marks[0];
    if (c.marks.length > 1 || m.type.name !== "link" || isPdfLink(m.attrs.href)) return null;  // a PDF attached to the note is a chip (./files), not a card
    if (m.attrs.markup) text += c.text;
    else if (i === 0 && p.childCount === 1) href = m.attrs.href;
    else return null;
  }
  if (href) return BARE.test(href) ? href : null;
  text = text.trim();
  return BARE.test(text) && !isPdfLink(text) ? text : null;
}

/** Every paragraph that is one URL at the top of the note, with the position just after it. */
function bareUrls(doc: Node): { url: string; end: number; from: number }[] {
  const out: { url: string; end: number; from: number }[] = [];
  doc.forEach((n, offset) => {
    const url = cardUrl(n);
    if (url) out.push({ url, from: offset, end: offset + n.nodeSize });
  });
  return out;
}

const blank = (n: Node | null | undefined) => n?.type.name === "paragraph" && n.content.size === 0;

/** These are edits of the owner's: not an undo or a redo, not a body that came from elsewhere. */
const edited = (trs: readonly Transaction[]) =>
  trs.some((tr) => tr.docChanged) && !trs.some((tr) => isHistoryTransaction(tr) || tr.getMeta("addToHistory") === false);

/** The caret, when it closes a card's line at the top of the note. */
function closing(state: EditorState) {
  const { $from, empty } = state.selection;
  return empty && $from.depth === 1 && $from.parentOffset === $from.parent.content.size && cardUrl($from.parent) ? $from : null;
}

/** The position after the card line the caret closes, when the edit put its whole URL on an empty line at once (a
 *  paste, the keyboard's clipboard). Typed, a URL grows a letter at a time and stays under the caret. null otherwise. */
function arrived(old: EditorState, state: EditorState): number | null {
  const was = old.selection.$from, now = closing(state);
  return now && old.selection.empty && was.depth === 1 && was.index(0) === now.index(0) && blank(was.parent) ? now.after(1) : null;
}

/** The empty line that was already under a card's line when Enter at its end made another: one is enough. */
function spare(old: EditorState, state: EditorState): { from: number; to: number } | null {
  const was = closing(old), now = state.selection.$from;
  if (!was || !state.selection.empty || now.depth !== 1 || now.index(0) !== was.index(0) + 1 || !blank(now.parent)) return null;
  if (state.doc.childCount !== old.doc.childCount + 1 || !state.doc.child(was.index(0)).eq(was.parent)) return null;
  const from = now.after(1), next = state.doc.nodeAt(from);
  return next && blank(next) ? { from, to: from + next.nodeSize } : null;
}

/** What keeps the caret off a card's line (see the top), and one empty line under it: null when there is nothing to do. */
function settled(trs: readonly Transaction[], old: EditorState, state: EditorState): Transaction | null {
  const tr = state.tr, paragraph = state.schema.nodes.paragraph;
  if (edited(trs)) {
    const after = arrived(old, state), extra = spare(old, state);
    if (after !== null) {
      if (!blank(tr.doc.nodeAt(after))) tr.insert(after, paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView();
    } else if (extra) tr.delete(extra.from, extra.to);
  }
  const last = tr.doc.lastChild;
  if (last && cardUrl(last)) tr.insert(tr.doc.content.size, paragraph.create());
  return tr.docChanged || tr.selectionSet ? tr : null;
}

const safe = (u: string) => /^https?:\/\//i.test(u);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** An <img> that takes itself out when its address does not load. */
function picture(cls: string, src: string): HTMLImageElement {
  const img = el("img", cls);
  img.alt = "";
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.draggable = false;
  img.addEventListener("error", () => img.remove());
  img.src = src;
  return img;
}

type Tools = { read?: (url: string) => void; summarize?: Summarize; done: boolean; view: EditorView; getPos: () => number | undefined };

/** A link as an item: a thumbnail (the page's picture, else its icon, else a link mark: never an empty box), its title,
 *  description and site, and Read and Summary always beside them. `p` null: the page told nothing (or has not yet), so
 *  the item is the URL itself, still with its buttons. */
function card(url: string, p: LinkPreview | null, open: (url: string) => void, t: Tools): HTMLElement {
  const root = el("div", t.done ? "pm-card pm-card-joined" : "pm-card");
  root.contentEditable = "false";
  root.tabIndex = 0;
  root.setAttribute("role", "link");
  root.title = url;
  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* a bare URL that is not one: shown as typed */ }
  const thumb = el("div", "pm-card-thumb");
  const mark = () => { if (!thumb.firstChild) thumb.dataset.empty = ""; };
  const src = p && safe(p.image) ? p.image : p && safe(p.icon) ? p.icon : "";
  if (src) {
    const img = picture(safe(p?.image ?? "") ? "pm-card-image" : "pm-card-favicon", src);
    img.addEventListener("error", mark);
    thumb.append(img);
  } else mark();
  const body = el("div", "pm-card-body");
  body.append(el("div", "pm-card-title", p?.title || p?.site || host));
  if (p?.description) body.append(el("div", "pm-card-desc", p.description));
  const site = el("div", "pm-card-site");
  if (p && safe(p.icon) && safe(p.image)) site.append(picture("pm-card-icon", p.icon));
  site.append(el("span", "pm-card-host", p?.site || host));
  body.append(site);
  root.append(thumb, body);
  // Copy, Read, Summary and Delete: buttons of their own, so a click on the rest of the item still opens the page
  {
    const tools = el("div", "pm-card-tools");
    tools.append(copyButton("pm-link-tool", url));
    if (t.read) tools.append(readButton("pm-link-tool", url, t.read));
    if (t.summarize) {
      const btn = summaryButton("pm-link-tool", url, t.view, t.getPos, t.summarize);
      if (t.done) { (btn as HTMLButtonElement).disabled = true; btn.textContent = "Summarised"; btn.title = "The summary is under the link"; }
      tools.append(btn);
    }
    tools.append(deleteButton("pm-link-tool", t.view, () => {
      // The card sits at the end of its paragraph: Delete takes that paragraph (a summary under it stays, its own block)
      const end = t.getPos();
      const block = end === undefined ? null : t.view.state.doc.resolve(end).nodeBefore;
      return end === undefined || !block ? undefined : { from: end - block.nodeSize, to: end };
    }));
    root.append(tools);
  }
  root.addEventListener("click", (e) => { e.preventDefault(); open(url); });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(url); }
  });
  return root;
}

/** A YouTube link's player: its thumbnail and a play button until clicked, so a note with videos loads no player (nor
 *  YouTube's scripts) until one is wanted; the click plays it in the note. */
function video(url: string, v: { id: string; start: number }): HTMLElement {
  const root = el("div", "pm-video");
  root.contentEditable = "false";
  root.title = url;
  const play = el("button", "pm-video-play");
  play.type = "button";
  play.setAttribute("aria-label", "Play video");
  play.append(picture("pm-video-thumb", `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`), el("span", "pm-video-icon"));
  play.addEventListener("click", (e) => {
    e.preventDefault();
    const frame = el("iframe", "pm-video-frame");
    frame.src = youtubeEmbed(v);
    frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.title = "YouTube video";
    root.replaceChildren(frame);
  });
  play.addEventListener("keydown", (e) => e.stopPropagation());
  root.append(play);
  return root;
}

/** The plugin. `resolve`: where previews come from; `open`: what a click on a card does; `read`: its Read button and
 *  `summarize`: its Summary button (none without them; Summary shown done once the link has one under it, and that
 *  summary drawn as the card's lower half). A YouTube link's card is its player (see `video`). */
export function linkCards(resolve: ResolveLink, open: (url: string) => void, read?: (url: string) => void, summarize?: Summarize): Plugin {
  const known = new Map<string, LinkPreview | null>();      // looked up: a preview, or null for nothing to show
  const asked = new Map<string, number>();                  // in flight (0) or failed (when to try again)
  const queued = new Set<string>();                         // waiting to be looked up (a tick, or the typing pause)
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let view: EditorView | null = null;

  const lookup = (url: string) => {
    asked.set(url, 0);
    resolve(url).then(
      (p) => { known.set(url, p); asked.delete(url); },
      () => { asked.set(url, Date.now() + RETRY); },
    ).then(() => { if (view && !view.isDestroyed) view.dispatch(view.state.tr.setMeta("link-cards", url)); });
  };

  /** Ask for what is not known yet; a URL under the cursor waits to see whether it is still being typed. */
  const want = (state: EditorState) => {
    const at = state.selection.from;
    for (const { url, from, end } of bareUrls(state.doc)) {
      if (youtubeVideo(url)) continue;                      // a player, not a card: nothing to look up
      const retryAt = asked.get(url);
      if (known.has(url) || queued.has(url) || (retryAt !== undefined && (retryAt === 0 || retryAt > Date.now()))) continue;
      queued.add(url);
      const go = () => {
        queued.delete(url);
        if (view && !view.isDestroyed && bareUrls(view.state.doc).some((b) => b.url === url)) lookup(url);
      };
      if (at >= from && at <= end) {
        const t = setTimeout(() => { timers.delete(t); go(); }, TYPING);
        timers.add(t);
      } else queueMicrotask(go);
    }
  };

  return new Plugin({
    view(v) {
      view = v;
      return { destroy() { timers.forEach(clearTimeout); timers.clear(); view = null; } };
    },
    appendTransaction: settled,
    props: {
      decorations(state) {
        want(state);
        const out: Decoration[] = [];
        const { from: selFrom, to: selTo } = state.selection;
        for (const { url, from, end } of bareUrls(state.doc)) {
          // The line itself is hidden under its card or player: the card is the link. The caret on it (arrows, a
          // selection across it) shows it again to edit, while the editor has the focus (the stylesheet's rule, which
          // knows that), and the note's markdown never changes.
          const caret = selTo >= from && selFrom <= end;
          out.push(Decoration.node(from, end, { class: caret ? "pm-card-line pm-card-line-caret" : "pm-card-line" }));
          const v = youtubeVideo(url);
          if (v) {
            out.push(Decoration.widget(end, () => video(url, v), { key: `video:${url}`, side: -1, stopEvent: () => true, ignoreSelection: true }));
            continue;
          }
          const p = known.get(url) ?? null;
          const done = summarised(state.doc, end);
          out.push(Decoration.widget(end, (view, getPos) => card(url, p, open, { read, summarize, done, view, getPos }),
            { key: `card:${url}:${known.has(url) ? 1 : 0}:${done ? 1 : 0}`, side: -1, stopEvent: () => true, ignoreSelection: true }));
          // Its summary (the blockquote under the link) drawn as the card's lower half: still the note's own, editable text
          const summary = done ? state.doc.resolve(end).nodeAfter : null;
          if (summary) out.push(Decoration.node(end, end + summary.nodeSize, { class: "pm-card-summary" }));
        }
        return out.length ? DecorationSet.create(state.doc, out) : null;
      },
    },
  });
}
