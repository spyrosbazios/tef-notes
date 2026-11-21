// The editor's plugins keep their state across transactions: an edit rereads the blocks it touched, not the note.
// Counted as the nodes the plugins read: `nodesBetween` (which `descendants` goes through) and the children of anything
// but the document (a text block's runs). ProseMirror's own walk over the top-level blocks, when it builds a decoration
// set, is its own and left out.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Node } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Plugin, Transaction } from "prosemirror-state";
import type { DecorationSet, EditorView } from "prosemirror-view";
import { fileChips } from "../src/editor/files";
import { linkCards } from "../src/editor/link-cards";
import { readLinks } from "../src/editor/link-read";
import { parse } from "../src/editor/markdown";

let walked = 0;
const original = { forEach: Node.prototype.forEach, nodesBetween: Node.prototype.nodesBetween };
beforeEach(() => {
  Node.prototype.forEach = function (this: Node, f) {
    if (this.type.name === "doc") return original.forEach.call(this, f);
    return original.forEach.call(this, (...a: Parameters<typeof f>) => { walked++; return f(...a); });
  };
  Node.prototype.nodesBetween = function (this: Node, from, to, f, start) {
    return original.nodesBetween.call(this, from, to, (...a: Parameters<typeof f>) => { walked++; return f(...a); }, start);
  };
});
afterEach(() => { Node.prototype.forEach = original.forEach; Node.prototype.nodesBetween = original.nodesBetween; });

const SIZE = 600;
const note = () => Array.from({ length: SIZE }, (_, i) => i % 50 === 0 ? `https://example.com/page-${i}` : `Line ${i} with [a link](https://example.org/${i}) and [doc](../attachments/20261001-a/doc${i}.pdf) text`).join("\n\n");

const plugins = (): Plugin[] => [
  fileChips(() => (src) => src, (href) => `/pdf/${href}`),
  readLinks(() => {}),
  linkCards(() => Promise.resolve(null), () => {}),
];
const open = () => {
  const s = EditorState.create({ doc: parse(note()), plugins: plugins() });
  return s.apply(s.tr.setMeta("addToHistory", false));
};
/** What the view draws for a state: every plugin's decorations. */
const drawn = (s: EditorState) => s.plugins.flatMap((p) => {
  const set = p.props.decorations?.call(p, s) as DecorationSet | null | undefined;
  return set ? set.find().map((d) => `${d.from}-${d.to}`) : [];
});
const mid = (s: EditorState) => {
  let at = 0;
  s.doc.forEach((_n, o, i) => { if (i === 300) at = o + 1; });
  return at;
};

describe("a transaction in a long note", () => {
  test("typing reads a handful of nodes, not the note", () => {
    const s = open();
    drawn(s);
    walked = 0;
    const next = s.apply(s.tr.insertText("x", mid(s)));
    drawn(next);
    expect(walked).toBeLessThan(100);
  });
  test("moving the caret reads a handful of nodes", () => {
    const s = open();
    drawn(s);
    walked = 0;
    const next = s.apply(s.tr.setSelection(TextSelection.create(s.doc, mid(s))));
    drawn(next);
    expect(walked).toBeLessThan(100);
  });
});

describe("what the plugins draw stays what a full read would draw", () => {
  const fresh = (s: EditorState) => {
    const f = EditorState.create({ doc: s.doc, plugins: plugins(), selection: s.selection });
    return drawn(f.apply(f.tr.setMeta("addToHistory", false)));
  };
  test("after typing, a deletion, a new link and a paste", () => {
    let s = open();
    const step = (tr: Transaction) => { s = s.apply(tr); expect(drawn(s).sort()).toEqual(fresh(s).sort()); };
    step(s.tr.insertText("x", mid(s)));
    step(s.tr.delete(mid(s), mid(s) + 6));
    step(s.tr.insertText(" [n](https://new.example/p) ", mid(s)));
    step(s.tr.replaceWith(0, 0, parse("https://top.example/a\n\nhello").content));
    step(s.tr.delete(0, s.doc.firstChild!.nodeSize));
  });
});

describe("the card plugin's lookups", () => {
  const URL = "https://example.com/a";
  test("a decoration never asks; the plugin view asks once per URL", async () => {
    const asked: string[] = [];
    const p = linkCards((u) => { asked.push(u); return Promise.resolve(null); }, () => {});
    let s = EditorState.create({ doc: parse(`${URL}\n\nwords`), plugins: [p] });
    s = s.apply(s.tr.setMeta("addToHistory", false));
    s = s.apply(s.tr.setSelection(TextSelection.atEnd(s.doc)));      // not on the URL's line: no typing pause
    p.props.decorations?.call(p, s);
    p.props.decorations?.call(p, s);
    await Promise.resolve();
    expect(asked).toEqual([]);
    const view = { state: s, isDestroyed: false, dispatch: (tr: Transaction) => { view.state = view.state.apply(tr); } };
    const plugged = p.spec.view?.(view as unknown as EditorView);
    await Promise.resolve();
    await Promise.resolve();
    expect(asked).toEqual([URL]);
    for (let i = 0; i < 5; i++) {
      view.state = view.state.apply(view.state.tr.insertText("y", view.state.doc.content.size - 1));
      plugged?.update?.(view as unknown as EditorView, s);
    }
    await Promise.resolve();
    expect(asked).toEqual([URL]);
    plugged?.destroy?.();
  });
});
