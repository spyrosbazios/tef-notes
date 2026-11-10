// Selected words held for an ask about them (the selection bar's AI field): they stay marked while the focus is in the
// field, their place follows the edits around them, and the agent's answer replaces them or lands under them as an edit
// of the owner's own (saved like typing, one step of the history). A change is refused when the words are not what was
// held any more: the owner typed into them meanwhile, and their typing wins.
import { closeHistory, undo } from "prosemirror-history";
import type { Node } from "prosemirror-model";
import { Plugin, PluginKey, TextSelection, type EditorState } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { markdownSlice, parse, sliceMarkdown } from "./markdown";

/** The held words, while the ask about them is open. */
export type Held = {
  /** The words as markdown, as the agent is sent them: as they are now (an answer may have changed them). */
  markdown(): string;
  /** Put `markdown` where the words are (empty removes them); afterwards the new text is what is held. */
  replace(markdown: string): boolean;
  /** Add `markdown`'s blocks under the top-level block the words end in. */
  insertAfter(markdown: string): boolean;
  /** Nothing was typed since the last change made here: `undo` takes exactly that change back. */
  canUndo(): boolean;
  undo(): boolean;
  /** The words are no longer held: the mark goes, and every later change is refused. */
  release(): void;
};

type Range = { id: number; from: number; to: number };
const key = new PluginKey<Range | null>("held");

/** Where the held words are now, if any are held. */
export const heldRange = (state: EditorState): { from: number; to: number } | null => key.getState(state) ?? null;

/** The held range, mapped through every edit, drawn as a mark. */
export const heldMark = new Plugin<Range | null>({
  key,
  state: {
    init: () => null,
    apply(tr, range) {
      const meta = tr.getMeta(key) as Range | null | undefined;
      if (meta !== undefined) return meta;
      if (!range || !tr.docChanged) return range;
      return { id: range.id, from: tr.mapping.map(range.from, 1), to: Math.max(tr.mapping.map(range.from, 1), tr.mapping.map(range.to, -1)) };
    },
  },
  props: {
    decorations(state) {
      const r = key.getState(state);
      return r && r.to > r.from ? DecorationSet.create(state.doc, [Decoration.inline(r.from, r.to, { class: "pm-held" })]) : null;
    },
  },
});

/** The text between two places, the way the held words are compared. */
const textOf = (doc: Node, from: number, to: number) => doc.textBetween(from, to, "\n", "￼");

let ids = 0;

/** What a hold needs of the view (the tests hand in a plain state and dispatch). */
export type HoldView = Pick<EditorView, "state" | "dispatch" | "isDestroyed">;

/** Hold the view's text selection; null when there is none to hold. */
export function hold(view: HoldView): Held | null {
  const sel = view.state.selection;
  if (sel.empty || !(sel instanceof TextSelection)) return null;
  const id = ++ids;
  let expected = textOf(view.state.doc, sel.from, sel.to), after: Node | null = null;
  const first = sliceMarkdown(sel.content());
  view.dispatch(view.state.tr.setMeta(key, { id, from: sel.from, to: sel.to }));

  /** The range while it is this hold's and still holds the words it was given. */
  const live = (): Range | null => {
    if (view.isDestroyed) return null;
    const r = key.getState(view.state);
    return r?.id === id && textOf(view.state.doc, r.from, r.to) === expected ? r : null;
  };
  const commit = (tr: Transaction, next: Range) => {
    view.dispatch(closeHistory(tr).setMeta(key, next).scrollIntoView());
    after = view.state.doc;
  };

  return {
    markdown() {
      const r = view.isDestroyed ? null : key.getState(view.state);
      return r?.id === id ? sliceMarkdown(view.state.doc.slice(r.from, r.to)) : first;
    },
    replace(markdown) {
      const r = live();
      if (!r) return false;
      const tr = view.state.tr.replaceRange(r.from, r.to, markdownSlice(markdown));
      const next = { id, from: tr.mapping.map(r.from, -1), to: tr.mapping.map(r.to, 1) };
      expected = textOf(tr.doc, next.from, next.to);
      commit(tr, next);
      return true;
    },
    insertAfter(markdown) {
      const r = live();
      if (!r || !markdown.trim()) return false;
      const blocks = parse(markdown).content;
      const $to = view.state.doc.resolve(r.to);
      const tr = view.state.tr.insert($to.depth ? $to.after(1) : r.to, blocks);
      commit(tr, { id, from: tr.mapping.map(r.from, 1), to: tr.mapping.map(r.to, -1) });
      return true;
    },
    canUndo: () => !view.isDestroyed && after !== null && view.state.doc === after,
    undo() {
      if (view.isDestroyed || !after || view.state.doc !== after) return false;
      after = null;
      const done = undo(view.state, view.dispatch);
      // The words are back as they were: what the hold holds again (its range came back with them through the mapping)
      const r = key.getState(view.state);
      if (done && r?.id === id) expected = textOf(view.state.doc, r.from, r.to);
      return done;
    },
    release() {
      if (view.isDestroyed || key.getState(view.state)?.id !== id) return;
      view.dispatch(view.state.tr.setMeta(key, null));
    },
  };
}
