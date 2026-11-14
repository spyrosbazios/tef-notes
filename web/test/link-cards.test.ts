// Which paragraphs get a link card: only a paragraph that is nothing but one URL. And where the caret goes around one.
import { describe, expect, test } from "bun:test";
import { baseKeymap, splitBlock } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { EditorState, TextSelection } from "prosemirror-state";
import type { DecorationSet } from "prosemirror-view";
import { cardUrl, linkCards } from "../src/editor/link-cards";
import { summarised } from "../src/editor/link-tools";
import { markdownSlice, parse, schema, serialize } from "../src/editor/markdown";

const urls = (md: string) => {
  const out: (string | null)[] = [];
  parse(md).forEach((n) => out.push(cardUrl(n)));
  return out;
};

describe("cardUrl", () => {
  test("a URL alone on its line, however it was written", () => {
    expect(urls("https://example.com/a?b=1\n\n<https://example.org/x>\n\nhttp://example.net/")).toEqual([
      "https://example.com/a?b=1", "https://example.org/x", "http://example.net/",
    ]);
  });
  test("surrounding whitespace does not matter", () => {
    expect(urls("  https://example.com/a  \n")).toEqual(["https://example.com/a"]);
  });
  test("a labelled link that is the whole line: its address", () => {
    expect(urls("[a page](https://example.com/a)")).toEqual(["https://example.com/a"]);
  });
  test("prose, a link among words, a marked or coded URL do not", () => {
    expect(urls("see https://example.com/a\n\nsee [a page](https://example.com/a)\n\n[a **b**](https://example.com/a)\n\n**https://example.com/a**\n\n`https://example.com/a`\n\nhttps://a.com/x https://b.com/y")).toEqual([null, null, null, null, null, null]);
  });
  test("only at the top: a URL in a list or quote stays a link", () => {
    expect(urls("- https://example.com/a\n\n> https://example.com/b")).toEqual([null, null]);
  });
  test("a heading or a break in the paragraph is not one", () => {
    expect(urls("# https://example.com/a\n\nhttps://example.com/a\nhttps://example.com/b")).toEqual([null, null]);
  });
  test("other schemes are not", () => {
    expect(urls("ftp://example.com/a\n\nmailto:a@b.co")).toEqual([null, null]);
  });
  test("a PDF attached to the note is a chip, not a card", () => {
    expect(urls("https://example.com/attachments/20261005-a/doc.pdf\n\n<https://example.com/attachments/20261005-a/doc.pdf>\n\n[https://example.com/a](../attachments/20261005-a/doc.pdf)")).toEqual([null, null, null]);
  });
});

describe("summarised", () => {
  const after = (md: string) => { const d = parse(md); return summarised(d, d.firstChild!.nodeSize); };
  test("a summary quote under the link, its first line Summary and a list after it", () => {
    expect(after("[a page](https://example.com/a)\n\n> **Summary**\n>\n> - one\n> - two")).toBe(true);
  });
  test("any other quote, or none, is not", () => {
    expect(after("[a page](https://example.com/a)\n\n> Summaryish words")).toBe(false);
    expect(after("[a page](https://example.com/a)\n\nSummary")).toBe(false);
  });
});

describe("the caret and a card's line", () => {
  const URL = "https://example.com/a";
  const cards = () => linkCards(() => Promise.resolve(null), () => {});
  // A note as the editor opens it: the plugins' rules applied once (src/editor/index.ts)
  const open = (md: string, plugins = [cards()]) => {
    const s = EditorState.create({ doc: parse(md), plugins });
    return s.apply(s.tr.setMeta("addToHistory", false));
  };
  const blocks = (s: EditorState) => { const out: string[] = []; s.doc.forEach((n) => out.push(n.textContent)); return out; };
  const caretBlock = (s: EditorState) => s.selection.$from.index(0);
  const paste = (s: EditorState, text: string) => s.apply(s.tr.replaceSelection(markdownSlice(text)));
  const lineClasses = (s: EditorState) => {
    const plugin = s.plugins[0];
    const set = plugin.props.decorations?.call(plugin, s) as DecorationSet;
    return set.find().map((d) => (d as unknown as { type: { attrs?: { class?: string } } }).type.attrs?.class).filter((c) => c?.startsWith("pm-card-line"));
  };

  test("a URL pasted on an empty line: the caret goes to a line after it", () => {
    const s = paste(open(""), URL);
    expect(blocks(s)).toEqual([URL, ""]);
    expect(caretBlock(s)).toBe(1);
    expect(serialize(s.doc)).toBe(`${URL}\n`);
    expect(lineClasses(s)).toEqual(["pm-card-line"]);
  });
  test("between lines it takes the empty line under it, or makes one", () => {
    const taken = open(`one\n\ntwo`);
    const empty = taken.apply(taken.tr.insert(taken.doc.firstChild!.nodeSize, [schema.nodes.paragraph.create(), schema.nodes.paragraph.create()]));
    const at = empty.apply(empty.tr.setSelection(TextSelection.create(empty.doc, empty.doc.firstChild!.nodeSize + 1)));
    const s = paste(at, URL);
    expect(blocks(s)).toEqual(["one", URL, "", "two"]);
    expect(caretBlock(s)).toBe(2);
    const made = open(`one\n\ntwo`);
    const line = made.apply(made.tr.insert(made.doc.firstChild!.nodeSize, schema.nodes.paragraph.create()));
    const s2 = paste(line.apply(line.tr.setSelection(TextSelection.create(line.doc, line.doc.firstChild!.nodeSize + 1))), URL);
    expect(blocks(s2)).toEqual(["one", URL, "", "two"]);
    expect(caretBlock(s2)).toBe(2);
  });
  test("typed, the URL stays under the caret, its line marked for it", () => {
    let s = open("");
    for (const ch of URL) s = s.apply(s.tr.insertText(ch));
    expect(blocks(s)).toEqual([URL, ""]);
    expect(caretBlock(s)).toBe(0);
    expect(lineClasses(s)).toEqual(["pm-card-line pm-card-line-caret"]);
  });
  test("Enter after a typed URL goes to the one empty line under it", () => {
    let s = open("", [cards(), keymap(baseKeymap)]);
    for (const ch of URL) s = s.apply(s.tr.insertText(ch));
    splitBlock(s, (t) => { s = s.apply(t); });
    expect(blocks(s)).toEqual([URL, ""]);
    expect(caretBlock(s)).toBe(1);
    splitBlock(s, (t) => { s = s.apply(t); });
    expect(blocks(s)).toEqual([URL, "", ""]);
    expect(caretBlock(s)).toBe(2);
  });
  test("pasted among words it is prose: nothing moves", () => {
    const s0 = open("");
    const s = paste(s0.apply(s0.tr.insertText("see ")), URL);
    expect(blocks(s)).toEqual([`see ${URL}`]);
    expect(caretBlock(s)).toBe(0);
  });
  test("a note never ends on a card's line, from its opening, and its markdown is the same", () => {
    const s = open(`words\n\n${URL}`);
    expect(blocks(s)).toEqual(["words", URL, ""]);
    expect(serialize(s.doc)).toBe(`words\n\n${URL}\n`);
    expect(blocks(open(`${URL}\n\nwords`))).toEqual([URL, "words"]);
  });
  test("deleting back onto the line from under it leaves the caret there", () => {
    const s0 = paste(open(""), URL);
    const s = s0.apply(s0.tr.delete(s0.doc.firstChild!.nodeSize - 1, s0.doc.firstChild!.nodeSize + 1));
    expect(blocks(s)).toEqual([URL, ""]);
    expect(caretBlock(s)).toBe(0);
  });
  test("a body from elsewhere, an undo and a redo move no caret", () => {
    const s0 = open("");
    const from = parse(URL);
    const tr = s0.tr.replaceWith(0, s0.doc.content.size, from.content).setMeta("addToHistory", false);
    const remote = s0.apply(tr.setSelection(TextSelection.create(tr.doc, tr.doc.firstChild!.nodeSize - 1)));
    expect(caretBlock(remote)).toBe(0);

    let s = open("", [cards(), history()]);
    s = paste(s, URL);
    undo(s, (t) => { s = s.apply(t); });
    expect(blocks(s)).toEqual([""]);
    redo(s, (t) => { s = s.apply(t); });
    expect(blocks(s)).toEqual([URL, ""]);
    expect(caretBlock(s)).toBe(1);
  });
});
