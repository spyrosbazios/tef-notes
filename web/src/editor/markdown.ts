// The note body as a ProseMirror document, and back: the schema, the markdown parser and the serializer.
// Pure: nothing here touches the DOM, so a Worker or a test can run it. The editor view,
// its keys and its node views live beside this file and import it, never the other way round.
//
// Dialect: GitHub-flavoured markdown (tables, `- [ ]` tasks, ~~strike~~, bare-URL links) with raw HTML kept
// as-is. A line break typed in a paragraph is kept as one (the phone and the web read do the same), so soft and
// hard breaks both come back as a bare newline. What doesn't survive a pass: setext headings become `#`,
// `__x__` becomes `**x**`, indented code becomes a fence, reference links become inline links (an unused
// `[ref]: url` definition vanishes), ordered lists are renumbered from their first number, trailing spaces go.
// A second pass changes nothing: serialize(parse(serialize(parse(x)))) === serialize(parse(x)).
import { noteLinkPath } from "@/core/links";
import MarkdownIt from "markdown-it";
import type { Token } from "markdown-it";
import { MarkdownParser, MarkdownSerializerState } from "prosemirror-markdown";
import type { ParseSpec } from "prosemirror-markdown";
import { Fragment, Schema, Slice } from "prosemirror-model";
import type { Mark, Node, NodeSpec } from "prosemirror-model";
import { tableNodes } from "prosemirror-tables";

export type Align = "left" | "center" | "right" | null;

const table = tableNodes({
  tableGroup: "block",
  cellContent: "inline*",     // a markdown cell holds one line of inline content
  cellAttributes: {
    align: {
      default: null,
      getFromDOM: (dom) => (dom as HTMLElement).style.textAlign || null,
      setDOMAttr: (v, attrs) => { if (v) attrs.style = `${attrs.style ?? ""}text-align:${v};`; },
    },
  },
});

const nodes: Record<string, NodeSpec> = {
  doc: { content: "block+" },
  paragraph: { content: "inline*", group: "block", parseDOM: [{ tag: "p" }], toDOM: () => ["p", 0] },
  blockquote: { content: "block+", group: "block", defining: true, parseDOM: [{ tag: "blockquote" }], toDOM: () => ["blockquote", 0] },
  horizontal_rule: { group: "block", parseDOM: [{ tag: "hr" }], toDOM: () => ["hr"] },
  heading: {
    attrs: { level: { default: 1 } },
    content: "inline*", group: "block", defining: true,
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
    toDOM: (n) => [`h${n.attrs.level}`, 0],
  },
  code_block: {
    attrs: { params: { default: "" } },
    content: "text*", marks: "", group: "block", code: true, defining: true,
    parseDOM: [{ tag: "pre", preserveWhitespace: "full", getAttrs: (dom) => ({ params: (dom as HTMLElement).getAttribute("data-params") ?? "" }) }],
    toDOM: (n) => ["pre", n.attrs.params ? { "data-params": n.attrs.params } : {}, ["code", 0]],
  },
  html_block: {
    content: "text*", marks: "", group: "block", code: true, defining: true,
    toDOM: () => ["pre", { class: "html-block" }, ["code", 0]],
  },
  // `marker` is the list's own bullet (`-` `*` `+`) or number delimiter (`.` `)`): two lists that touch
  // stay two lists only while their markers differ. `tight`: no blank lines between the items.
  bullet_list: {
    attrs: { tight: { default: true }, marker: { default: "-" } },
    content: "list_item+", group: "block", parseDOM: [{ tag: "ul" }], toDOM: () => ["ul", 0],
  },
  ordered_list: {
    attrs: { order: { default: 1 }, tight: { default: true }, marker: { default: "." } },
    content: "list_item+", group: "block",
    parseDOM: [{ tag: "ol", getAttrs: (dom) => ({ order: Number((dom as HTMLElement).getAttribute("start")) || 1 }) }],
    toDOM: (n) => ["ol", n.attrs.order === 1 ? {} : { start: n.attrs.order }, 0],
  },
  // `checked`: null for a plain item, true or false for a task (`- [x]` / `- [ ]`)
  list_item: {
    attrs: { checked: { default: null } },
    content: "block+", defining: true, parseDOM: [{ tag: "li" }], toDOM: () => ["li", 0],
  },
  ...table,
  text: { group: "inline" },
  hard_break: { inline: true, group: "inline", selectable: false, parseDOM: [{ tag: "br" }], toDOM: () => ["br"] },
  // `src` is what the file says (`../attachments/<note>/<name>.jpg`); the view decides what to show for it
  image: {
    attrs: { src: {}, alt: { default: "" }, title: { default: null } },
    inline: true, group: "inline", draggable: true,
    parseDOM: [{ tag: "img[src]", getAttrs: (dom) => {
      const e = dom as HTMLElement;
      return { src: e.getAttribute("src"), alt: e.getAttribute("alt") ?? "", title: e.getAttribute("title") };
    } }],
    toDOM: (n) => ["img", { src: n.attrs.src, alt: n.attrs.alt, title: n.attrs.title }],
  },
  html_inline: { attrs: { html: {} }, inline: true, group: "inline", atom: true, toDOM: (n) => ["span", { class: "html-inline" }, n.attrs.html] },
};

export const schema = new Schema({
  nodes,
  marks: {
    // `markup`: how the link was written, so a bare URL comes back bare: "autolink" (`<url>`), "linkify" (url), or null
    link: {
      attrs: { href: {}, title: { default: null }, markup: { default: null } },
      inclusive: false,
      parseDOM: [{ tag: "a[href]", getAttrs: (dom) => ({ href: (dom as HTMLElement).getAttribute("href"), title: (dom as HTMLElement).getAttribute("title") }) }],
      // A link to another note is marked: a plain click opens it (index.ts), and it shows a pointer
      toDOM: (m) => ["a", { href: m.attrs.href, title: m.attrs.title, "data-note": noteLinkPath(m.attrs.href) ? "" : null }, 0],
    },
    em: { parseDOM: [{ tag: "i" }, { tag: "em" }, { style: "font-style=italic" }], toDOM: () => ["em", 0] },
    strong: { parseDOM: [{ tag: "strong" }, { tag: "b" }, { style: "font-weight=bold" }], toDOM: () => ["strong", 0] },
    strike: { parseDOM: [{ tag: "s" }, { tag: "del" }, { tag: "strike" }], toDOM: () => ["s", 0] },
    code: { parseDOM: [{ tag: "code" }], toDOM: () => ["code", 0] },
  },
});

// ---- parse

/** `[ ]` / `[x]` opening a list item's first line becomes the item's `checked` and leaves the text. A box counts as
 *  md4c and remark-gfm count one: the `]` followed by a blank or the line's end (`- [x]draft` is text). */
function taskLists(md: MarkdownIt) {
  md.core.ruler.after("inline", "task_lists", (state) => {
    const t = state.tokens;
    for (let i = 0; i + 2 < t.length; i++) {
      if (t[i].type !== "list_item_open" || t[i + 1].type !== "paragraph_open" || t[i + 2].type !== "inline") continue;
      const inline = t[i + 2], m = /^\[([ xX])\](?:[ \t]+|$)/.exec(inline.content), first = inline.children?.[0];
      if (!m || first?.type !== "text" || !first.content.startsWith(m[0])) continue;
      first.content = first.content.slice(m[0].length);
      inline.content = inline.content.slice(m[0].length);
      t[i].meta = { checked: m[1] !== " " };
    }
    return true;
  });
}

/** `<br>` and `<br/>` are the table cell's only way to break a line: they are a break, not raw HTML. */
function htmlBreaks(md: MarkdownIt) {
  md.core.ruler.after("inline", "html_breaks", (state) => {
    for (const t of state.tokens) {
      for (const c of t.children ?? []) if (c.type === "html_inline" && /^<br\s*\/?>$/i.test(c.content)) c.type = "hardbreak";
    }
    return true;
  });
}

const tokenizer = new MarkdownIt("default", { html: true, linkify: true, breaks: false })
  .use(taskLists)
  .use(htmlBreaks);
tokenizer.linkify.set({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false });
// Links stay as written: markdown-it would percent-encode a Greek or spaced URL, and rewrite the note on a save
tokenizer.normalizeLink = (url) => url;
tokenizer.normalizeLinkText = (text) => text;

/** A list is tight when its first item's paragraph is hidden (markdown-it hides them all, or none). */
function tight(tokens: Token[], i: number): boolean {
  const level = tokens[i].level + 2;
  for (let j = i + 1; j < tokens.length && tokens[j].level > tokens[i].level; j++) if (tokens[j].type === "paragraph_open" && tokens[j].level === level) return tokens[j].hidden;
  return true;
}

const align = (t: Token): Align => (/text-align:\s*(left|center|right)/.exec(t.attrGet("style") ?? "")?.[1] as Align) ?? null;

const spec: Record<string, ParseSpec> = {
  blockquote: { block: "blockquote" },
  paragraph: { block: "paragraph" },
  list_item: { block: "list_item", getAttrs: (t) => ({ checked: t.meta?.checked ?? null }) },
  bullet_list: { block: "bullet_list", getAttrs: (t, ts, i) => ({ tight: tight(ts, i), marker: t.markup }) },
  ordered_list: { block: "ordered_list", getAttrs: (t, ts, i) => ({ order: Number(t.attrGet("start")) || 1, tight: tight(ts, i), marker: t.markup }) },
  heading: { block: "heading", getAttrs: (t) => ({ level: Number(t.tag.slice(1)) }) },
  code_block: { block: "code_block", noCloseToken: true },
  fence: { block: "code_block", getAttrs: (t) => ({ params: t.info.trim() }), noCloseToken: true },
  html_block: { block: "html_block", noCloseToken: true },
  hr: { node: "horizontal_rule" },
  table: { block: "table" },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: "table_row" },
  th: { block: "table_header", getAttrs: (t) => ({ align: align(t) }) },
  td: { block: "table_cell", getAttrs: (t) => ({ align: align(t) }) },
  image: { node: "image", getAttrs: (t) => ({ src: t.attrGet("src"), alt: t.content, title: t.attrGet("title") }) },
  hardbreak: { node: "hard_break" },
  softbreak: { node: "hard_break" },
  html_inline: { node: "html_inline", getAttrs: (t) => ({ html: t.content }) },
  em: { mark: "em" },
  strong: { mark: "strong" },
  s: { mark: "strike" },
  link: { mark: "link", getAttrs: (t) => ({ href: t.attrGet("href"), title: t.attrGet("title"), markup: t.markup === "autolink" || t.markup === "linkify" ? t.markup : null }) },
  code_inline: { mark: "code", noCloseToken: true },
};

const parser = new MarkdownParser(schema, tokenizer, spec);

export const parse = (markdown: string): Node => parser.parse(markdown);

// ---- serialize

const PUNCT = /[!-/:-@[-`{-~]/;
const ALNUM = /[\p{L}\p{N}]/u;

/** A `[` that could open a link: its `]` is followed by `(`, `[` or `:`, or isn't in this text (a mark may close it). */
function opensLink(str: string, at: number): boolean {
  const close = str.indexOf("]", at);
  return close < 0 || "([:".includes(str[close + 1] ?? "");
}

type Render = (state: State, node: Node, parent: Node, index: number) => void;

type StateConstructor = new (nodes: Record<string, Render>, marks: Record<string, unknown>, options: { tightLists: boolean }) => State;

class State extends MarkdownSerializerState {
  // The serializer's working fields are `@internal` in its typings and still there at runtime: the dialect needs them
  declare out: string;
  declare delim: string;
  declare closed: Node | null;
  declare atBlockStart: boolean;
  declare inAutolink: boolean | undefined;
  declare atBlank: () => boolean;

  /** The marker of the list closed last, to tell two lists that touch apart. */
  lastMarker: string | null = null;

  /** Escapes only what would read as markup: a `snake_case` or a lone `[` stays as typed. */
  override esc(str: string, startOfLine = false): string {
    const space = /\s/;
    let out = "";
    for (let i = 0; i < str.length; i++) {
      const c = str[i], prev = str[i - 1], next = str[i + 1];
      const flat = prev !== undefined && next !== undefined;
      if (c === "\\") out += next === undefined || PUNCT.test(next) ? "\\\\" : c;
      else if (c === "`") out += "\\`";
      else if (c === "*") out += flat && space.test(prev) && space.test(next) ? c : "\\*";
      else if (c === "_") out += flat && ((ALNUM.test(prev) && ALNUM.test(next)) || (space.test(prev) && space.test(next))) ? c : "\\_";
      else if (c === "~") out += prev === "~" || next === "~" ? "\\~" : c;
      else if (c === "[") out += opensLink(str, i) ? "\\[" : c;
      else if (c === "]") out += next !== undefined && "([:".includes(next) ? "\\]" : c;
      else if (c === "<") out += next !== undefined && /[A-Za-z/!?]/.test(next) ? "\\<" : c;
      else if (c === "&") out += /^(#\d+|#x[\da-f]+|[a-z][a-z\d]*);/i.test(str.slice(i + 1)) ? "\\&" : c;
      else if (c === "\u00a0") out += "&nbsp;";
      else out += c;
    }
    if (startOfLine) {
      out = out.replace(/^(\s*)(\+(?= )|[-*>])/, "$1\\$2").replace(/^(\s*)(#{1,6})(\s|$)/, "$1\\$2$3")
        .replace(/^(\s*\d+)([.)])(\s|$)/, "$1\\$2$3").replace(/^(\s*)(=+)\s*$/, "$1\\$2").replace(/^\[(?=[ xX]\](\s|$))/, "\\[");
    }
    return out;
  }

  /** As the library's, but a line that follows a break is a line start too (`>` or `1.` there must be escaped). */
  override text(text: string, escape = true) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const blank = this.atBlank();
      this.write();
      if (!escape && lines[i][0] === "[" && /(^|[^\\])!$/.test(this.out.slice(-2))) this.out = `${this.out.slice(0, -1)}\\!`;
      this.out += escape ? this.esc(lines[i], this.atBlockStart || blank) : lines[i];
      if (i !== lines.length - 1) this.out += "\n";
    }
  }

  /** `node`'s inline content as one line, for a table cell: the pipe is the cell's edge, so it is escaped. */
  cell(node: Node): string {
    const { out, delim, closed } = this;
    this.out = "|"; this.delim = ""; this.closed = null;       // not at a line start: a leading `-` or `1.` stays as is
    this.renderInline(node, false);
    const text = this.out.slice(1).replace(/\|/g, "\\|");
    this.out = out; this.delim = delim; this.closed = closed;
    return text.trim();
  }
}

const dest = (src: string) => (!src || /[\s<>]/.test(src) || !balanced(src) ? `<${src.replace(/[<>]/g, "\\$&")}>` : src);
const balanced = (s: string) => { let n = 0; for (const c of s) { if (c === "(") n++; else if (c === ")" && --n < 0) return false; } return n === 0; };
const quote = (t: string | null) => (t ? ` "${t.replace(/["\\]/g, "\\$&")}"` : "");

const taskBox = (item: Node) => (item.attrs.checked == null ? "" : item.attrs.checked ? "[x] " : "[ ] ");
const alt = (m: string) => ({ "-": "*", "*": "-", "+": "-", ".": ")", ")": "." })[m] ?? m;

/** The marker for a list of this type: its own, unless it touches a list closed just before that used it. */
function marker(state: State, node: Node): string {
  const m = state.closed?.type === node.type && state.lastMarker === node.attrs.marker ? alt(node.attrs.marker) : node.attrs.marker;
  state.lastMarker = m;
  return m;
}

const RULE: Record<NonNullable<Align>, string> = { left: ":---", center: ":---:", right: "---:" };

const inCell = (parent: Node) => parent.type.name === "table_cell" || parent.type.name === "table_header";

const nodeSerializers: Record<string, Render> = {
  blockquote: (state, node) => state.wrapBlock("> ", null, node, () => state.renderContent(node)),
  code_block: (state, node) => {
    // A backtick fence can't carry a backtick in its info string: that one is fenced in tildes
    const ch = node.attrs.params.includes("`") ? "~" : "`", longest = Math.max(2, ...(node.textContent.match(new RegExp(`${ch}{3,}`, "g")) ?? []).map((r) => r.length));
    const fence = ch.repeat(longest + 1);
    state.write(`${fence}${node.attrs.params}\n`);
    if (node.textContent) { state.text(node.textContent, false); state.write("\n"); }
    state.write(fence);
    state.closeBlock(node);
  },
  html_block: (state, node) => { state.write(); state.text(node.textContent, false); state.closeBlock(node); },
  heading: (state, node) => {
    state.write(`${"#".repeat(node.attrs.level)} `);
    state.renderInline(node, false);
    state.closeBlock(node);
  },
  horizontal_rule: (state, node) => { state.write("---"); state.closeBlock(node); },
  bullet_list: (state, node) => {
    const m = marker(state, node);
    state.renderList(node, "  ", (i) => `${m} ${taskBox(node.child(i))}`);
    state.lastMarker = m;
  },
  ordered_list: (state, node) => {
    const m = marker(state, node), start: number = node.attrs.order, width = String(start + node.childCount - 1).length;
    state.renderList(node, " ".repeat(width + 2), (i) => `${String(start + i).padStart(width)}${m} ${taskBox(node.child(i))}`);
    state.lastMarker = m;
  },
  list_item: (state, node) => state.renderContent(node),
  paragraph: (state, node) => { state.renderInline(node); state.closeBlock(node); },
  table: (state, node) => {
    const rows: string[][] = [], aligns: Align[] = [];
    node.forEach((row) => {
      const cells: string[] = [];
      row.forEach((cell, _, i) => { cells.push(state.cell(cell)); if (rows.length === 0) aligns[i] = cell.attrs.align; });
      rows.push(cells);
    });
    const cols = Math.max(...rows.map((r) => r.length));
    const line = (cells: string[]) => `| ${Array.from({ length: cols }, (_, i) => cells[i] ?? "").join(" | ")} |`;
    const rule = Array.from({ length: cols }, (_, i) => (aligns[i] ? RULE[aligns[i]] : "---"));
    const lines = [line(rows[0]), line(rule), ...rows.slice(1).map(line)];
    lines.forEach((l, i) => state.write(i < lines.length - 1 ? `${l}\n` : l));
    state.closeBlock(node);
  },
  image: (state, node) => state.write(`![${state.esc(node.attrs.alt)}](${dest(node.attrs.src)}${quote(node.attrs.title)})`),
  hard_break: (state, node, parent, index) => {
    if (index === 0) return;
    for (let i = index + 1; i < parent.childCount; i++) {
      if (parent.child(i).type === node.type) continue;
      state.out = state.out.replace(/[ \t]+$/, "");        // a space before the newline would be a hard break's own
      state.write(inCell(parent) ? "<br>" : parent.type.name === "heading" ? " " : "\n");
      return;
    }
  },
  html_inline: (state, node) => state.write(node.attrs.html),
  text: (state, node) => state.text(node.text!, !state.inAutolink),
};

/** A link whose text is its URL, written as a URL. */
function plainUrl(link: Mark, parent: Node, index: number): boolean {
  if (link.attrs.title) return false;
  const content = parent.child(index), href: string = link.attrs.href;
  if (!content.isText || content.marks[content.marks.length - 1] !== link) return false;
  if (content.text !== href && !(href.startsWith("mailto:") && content.text === href.slice(7))) return false;
  return index === parent.childCount - 1 || !link.isInSet(parent.child(index + 1).marks);
}

/** A bare URL ends where the text after it starts a word or a mark: only a space or the end sets it apart, else `<url>`. */
function bareUrl(link: Mark, parent: Node, index: number): boolean {
  if (link.attrs.markup !== "linkify") return false;
  const next = index + 1 < parent.childCount ? parent.child(index + 1) : null;
  return !next || next.type.name === "hard_break" || (next.isText && /^[ \t]/.test(next.text!));
}

const markSerializers = {
  em: { open: "*", close: "*", mixable: true, expelEnclosingWhitespace: true },
  strong: { open: "**", close: "**", mixable: true, expelEnclosingWhitespace: true },
  strike: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true },
  link: {
    open(state: State, mark: Mark, parent: Node, index: number) {
      state.inAutolink = plainUrl(mark, parent, index);
      return state.inAutolink ? (bareUrl(mark, parent, index) ? "" : "<") : "[";
    },
    close(state: State, mark: Mark, parent: Node, index: number) {
      const auto = state.inAutolink;
      state.inAutolink = undefined;
      return auto ? (bareUrl(mark, parent, index - 1) ? "" : ">") : `](${dest(mark.attrs.href)}${quote(mark.attrs.title)})`;
    },
    mixable: true,
  },
  code: {
    open: (_s: State, _m: Mark, parent: Node, index: number) => ticks(parent.child(index), -1),
    close: (_s: State, _m: Mark, parent: Node, index: number) => ticks(parent.child(index - 1), 1),
    escape: false,
  },
};

/** The backtick run that fences a code span: longer than any run inside, padded with a space when it has one. */
function ticks(node: Node, side: number): string {
  let len = 0;
  if (node.isText) for (const m of node.text!.matchAll(/`+/g)) len = Math.max(len, m[0].length);
  const run = "`".repeat(len + 1);
  return len > 0 ? (side < 0 ? `${run} ` : ` ${run}`) : run;
}

export function serialize(doc: Node): string {
  const state = new (State as unknown as StateConstructor)(nodeSerializers, markSerializers, { tightLists: true });
  state.renderContent(doc);
  return state.out ? `${state.out}\n` : "";
}

/** `md` as the editor would write it back after opening and closing the note: the one-off cleanup of a body. */
export const normalizeBody = (md: string): string => serialize(parse(md));

/** Markdown as a piece to put in the text (pasted, or the agent's answer to a selection): a lone paragraph merges into the
 *  text around it, so pasted words stay in the line; blocks stay blocks. */
export function markdownSlice(markdown: string): Slice {
  const doc = parse(markdown);
  return doc.childCount === 1 && doc.firstChild?.type === schema.nodes.paragraph
    ? new Slice(Fragment.from(doc.firstChild), 1, 1)
    : new Slice(doc.content, 0, 0);
}

/** A piece of the text as markdown (copied, or selected words sent to the agent): inline content is a paragraph's. */
export function sliceMarkdown(slice: Slice): string {
  const blocks = slice.content.firstChild?.isBlock ? slice.content : Fragment.from(schema.nodes.paragraph.create(null, slice.content));
  return serialize(schema.topNodeType.create(null, blocks)).replace(/\n$/, "");
}
