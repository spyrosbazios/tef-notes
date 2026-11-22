// What a body from elsewhere just changed (the assistant's write, another device's edit): the words that are new stay
// tinted for a moment, so the owner sees where the note moved without reading it again. `changedRanges` says which words
// those are, by comparing the document before and after; the plugin draws them and follows the edits made meanwhile.
// Words that only went leave nothing to tint.
import type { Node } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Range } from "./incremental";

/** How long the tint stays, ms: the CSS fade (`pm-fresh`, index.css) runs as long. */
export const FRESH_MS = 2600;

/** The most block pairs compared to line the two documents up; past it the blocks between the unchanged ends count as new. */
const PAIRS = 40_000;

/** Which of `b`'s blocks are also in `a`, in order (a longest common subsequence): for each of `b`'s, its match in `a` or -1. */
function matched(a: Node[], b: Node[]): number[] {
  const out = b.map(() => -1), n = a.length, m = b.length;
  if (!n || !m || n * m > PAIRS) return out;
  const w = m + 1, len = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    len[i * w + j] = a[i].eq(b[j]) ? len[(i + 1) * w + j + 1] + 1 : Math.max(len[(i + 1) * w + j], len[i * w + j + 1]);
  }
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i].eq(b[j])) out[j++] = i++;
    else if (len[(i + 1) * w + j] >= len[i * w + j + 1]) i++;
    else j++;
  }
  return out;
}

/** The part of the block `now` (at `pos`) that differs from `was`, the block it replaced; null when words only went. */
function within(was: Node, now: Node, pos: number): Range | null {
  if (now.isLeaf || !was.sameMarkup(now)) return [pos, pos + now.nodeSize];
  const start = was.content.findDiffStart(now.content), end = was.content.findDiffEnd(now.content);
  if (start == null || !end) return null;
  // The two ends can cross where the new words repeat what is beside them ("aa" from "a"): the end gives way
  const to = end.b + Math.max(0, start - Math.min(end.a, end.b));
  return to > start ? [pos + 1 + start, pos + 1 + to] : null;
}

/** Where `next` says something `old` didn't, in `next`'s positions: its new blocks whole, and of a block that replaced
 *  another one of its kind only the stretch that differs. */
export function changedRanges(old: Node, next: Node): Range[] {
  const a: Node[] = [], b: Node[] = [];
  old.forEach((n) => a.push(n));
  next.forEach((n) => b.push(n));
  let head = 0, tail = 0;
  while (head < a.length && head < b.length && a[head].eq(b[head])) head++;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail].eq(b[b.length - 1 - tail])) tail++;
  const was = a.slice(head, a.length - tail), now = b.slice(head, b.length - tail), kept = matched(was, now);

  const out: Range[] = [];
  let pos = 0;
  for (let i = 0; i < head; i++) pos += b[i].nodeSize;
  // Between two blocks both documents have: the old ones that went and the new ones that came
  let gone = 0, came: [Node, number][] = [];
  const close = (until: number) => {
    const olds = was.slice(gone, until);
    for (const [k, [node, at]] of came.entries()) {
      const r = olds.length === came.length ? within(olds[k], node, at) : [at, at + node.nodeSize] as const;
      if (r) out.push(r);
    }
    came = [];
  };
  now.forEach((node, j) => {
    if (kept[j] < 0) came.push([node, pos]);
    else { close(kept[j]); gone = kept[j] + 1; }
    pos += node.nodeSize;
  });
  close(was.length);
  return out;
}

const key = new PluginKey<DecorationSet>("fresh");

/** The tinted ranges, kept in place through the edits made while they show. */
export const fresh = new Plugin<DecorationSet>({
  key,
  state: {
    init: () => DecorationSet.empty,
    apply(tr, set) {
      const ranges = tr.getMeta(key) as Range[] | undefined;
      if (ranges) return DecorationSet.create(tr.doc, ranges.map(([from, to]) => Decoration.inline(from, to, { class: "pm-fresh" })));
      return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
    },
  },
  props: {
    decorations(state) { return key.getState(state); },
  },
});

/** The transaction made to tint `ranges` of its document; none clears the tint. */
export const tinted = (tr: Transaction, ranges: Range[]): Transaction => tr.setMeta(key, ranges);

/** What is tinted now. */
export const freshRanges = (state: EditorState): Range[] =>
  (key.getState(state)?.find() ?? []).map((d) => [d.from, d.to] as const);
