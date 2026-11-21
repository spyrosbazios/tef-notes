// What the editor's plugins share to keep their work in proportion to an edit, not to the note. A plugin that draws
// something from the document (a chip, a button, a card) keeps what it drew as its state: a transaction maps that state
// through its own changes and reads again only the blocks those changes touched.
import type { Node } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import type { PluginKey, Transaction } from "prosemirror-state";
import { AddMarkStep, RemoveMarkStep } from "prosemirror-transform";
import { Decoration, DecorationSet } from "prosemirror-view";

/** From and to, in the document as it is after the transaction. */
export type Range = readonly [from: number, to: number];

/** Where a transaction changed the document, in the new document's positions: what each step replaced, and the text a
 *  mark step marked or unmarked (it moves nothing, so its step map is empty). */
export function touched(tr: Transaction): Range[] {
  const size = tr.doc.content.size, at = (n: number) => Math.max(0, Math.min(n, size));
  const out: Range[] = [];
  tr.steps.forEach((step, i) => {
    const later = tr.mapping.slice(i + 1);
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) out.push([at(later.map(step.from, -1)), at(later.map(step.to, 1))]);
    else tr.mapping.maps[i].forEach((_a, _b, from, to) => { out.push([at(later.map(from, -1)), at(later.map(to, 1))]); });
  });
  return out;
}

/** The ranges in order, those that touch or overlap made one. */
function merged(ranges: Range[]): Range[] {
  const out: [number, number][] = [];
  for (const [from, to] of [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = out[out.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

/** Each range grown to take in the content of every text block it reaches, so a block is read whole or not at all. The
 *  content ranges of two blocks never touch (a block's closing and the next one's opening lie between them). */
export function textblockRanges(doc: Node, ranges: Range[]): Range[] {
  return merged(ranges.map(([from0, to0]) => {
    let from = from0, to = to0;
    doc.nodesBetween(from0, to0, (node, pos) => {
      if (!node.isTextblock) return true;
      from = Math.min(from, pos + 1);
      to = Math.max(to, pos + 1 + node.content.size);
      return false;
    });
    return [from, to] as const;
  }));
}

/** The top-level block holding `pos` (the one after it, between two blocks; the child count at the end), and where it starts. */
function blockAt(doc: Node, pos: number): [index: number, offset: number] {
  const $pos = doc.resolve(pos), index = $pos.index(0);
  return [index, index < doc.childCount ? $pos.posAtIndex(index, 0) : doc.content.size];
}

/** Each range grown to whole top-level blocks, `before` and `after` more of them at either side (what one block's
 *  drawing reads of its neighbours). */
export function blockRanges(doc: Node, ranges: Range[], before: number, after: number): Range[] {
  const count = doc.childCount;
  if (!count) return [];
  return merged(ranges.map(([from, to]) => {
    const [ai, ao] = blockAt(doc, from), [bi, bo] = blockAt(doc, to);
    let start = ao, end = bi < count ? bo + doc.child(bi).nodeSize : doc.content.size;
    for (let i = ai - 1, n = 0; i >= 0 && n < before; i--, n++) start -= doc.child(i).nodeSize;
    for (let i = bi + 1, n = 0; i < count && n < after; i++, n++) end += doc.child(i).nodeSize;
    return [start, end] as const;
  }));
}

/** The top-level block before the one each range starts in, or at (a range between two blocks): what a block's drawing
 *  reads of the block after it. */
function blocksBefore(doc: Node, ranges: Range[]): Range[] {
  return ranges.flatMap(([from]) => {
    const [index, offset] = blockAt(doc, from);
    return index > 0 ? [[offset - doc.child(index - 1).nodeSize, offset] as const] : [];
  });
}

/** The text blocks within `from`..`to`, with their position (`parent` the node holding the block). */
export function eachTextblock(doc: Node, from: number, to: number, f: (block: Node, at: number, parent: Node) => void) {
  doc.nodesBetween(from, to, (node, at, parent) => {
    if (!node.isTextblock) return true;
    f(node, at, parent ?? doc);
    return false;
  });
}

/** A plugin drawing decorations that belong to one text block each (inside its content): `scan` reads a block's. They
 *  are read for the whole note once, then kept, mapped through every transaction and read again only for the blocks the
 *  transaction touched. `behind`: a block's decorations also read the top-level block after it, so an edit rereads the
 *  top-level block before it too. `redraw`: a transaction carrying this key's meta reads everything again. */
export function blockDecorations(scan: (block: Node, at: number, parent: Node, doc: Node) => Decoration[], options: { behind?: boolean; redraw?: PluginKey } = {}): Plugin<DecorationSet> {
  const all = (doc: Node) => {
    const out: Decoration[] = [];
    eachTextblock(doc, 0, doc.content.size, (block, at, parent) => out.push(...scan(block, at, parent, doc)));
    return DecorationSet.create(doc, out);
  };
  return new Plugin<DecorationSet>({
    state: {
      init: (_config, state) => all(state.doc),
      apply(tr, set) {
        if (options.redraw && tr.getMeta(options.redraw)) return all(tr.doc);
        if (!tr.docChanged) return set;
        const raw = touched(tr);
        const dirty = merged([...textblockRanges(tr.doc, raw), ...(options.behind ? blocksBefore(tr.doc, raw) : [])]);
        let next = set.map(tr.mapping, tr.doc);
        for (const [from, to] of dirty) {
          next = next.remove(next.find(from, to));
          const found: Decoration[] = [];
          eachTextblock(tr.doc, from, to, (block, at, parent) => found.push(...scan(block, at, parent, tr.doc)));
          next = next.add(tr.doc, found);
        }
        return next;
      },
    },
    props: {
      decorations(this: Plugin<DecorationSet>, state) { return this.getState(state); },
    },
  });
}
