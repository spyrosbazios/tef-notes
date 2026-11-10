// Selected words held for an ask: the agent's answer replaces them or lands under them, as one undoable edit, and never
// over words the owner changed meanwhile.
import { describe, expect, test } from "bun:test";
import { history } from "prosemirror-history";
import { EditorState, TextSelection, type Transaction } from "prosemirror-state";
import { heldMark, hold, type HoldView } from "../src/editor/held";
import { parse, serialize } from "../src/editor/markdown";

/** A view of `md` with `words` selected: a plain state and dispatch, which is all a hold uses. */
function viewOf(md: string, words: string) {
  const doc = parse(md);
  let from = 0;
  doc.descendants((n, p) => { const i = n.isText ? n.text!.indexOf(words) : -1; if (i >= 0 && !from) from = p + i; });
  const v = {
    state: EditorState.create({ doc, plugins: [history(), heldMark], selection: TextSelection.create(doc, from, from + words.length) }),
    isDestroyed: false,
    dispatch(tr: Transaction) { v.state = v.state.apply(tr); },
  };
  const type = (at: number, text: string) => v.dispatch(v.state.tr.insertText(text, at));
  return { v: v as HoldView & typeof v, md: () => serialize(v.state.doc), type, from };
}

describe("a held selection", () => {
  test("is its words as markdown; nothing selected is nothing held", () => {
    const { v } = viewOf("Buy **fresh** eggs today\n", "fresh");
    expect(hold(v)?.markdown()).toBe("**fresh**");
    const empty = viewOf("one\n", "one");
    empty.v.dispatch(empty.v.state.tr.setSelection(TextSelection.create(empty.v.state.doc, 1)));
    expect(hold(empty.v)).toBeNull();
  });

  test("replace puts inline markdown in the line, and blocks as blocks", () => {
    const a = viewOf("Buy eggs today\n", "eggs");
    expect(hold(a.v)!.replace("*milk*")).toBe(true);
    expect(a.md()).toBe("Buy *milk* today\n");
    const b = viewOf("one\n\ntwo\n\nthree\n", "two");
    expect(hold(b.v)!.replace("- a\n- b")).toBe(true);
    expect(b.md()).toBe("one\n\n- a\n- b\n\nthree\n");
  });

  test("follows edits around the words, and refuses once the words themselves changed", () => {
    const a = viewOf("Buy eggs today\n", "eggs"), h = hold(a.v)!;
    a.type(1, "Go. ");
    expect(h.replace("milk")).toBe(true);
    expect(a.md()).toBe("Go. Buy milk today\n");
    const b = viewOf("Buy eggs today\n", "eggs"), g = hold(b.v)!;
    b.type(b.from + 2, "x");
    expect(g.replace("milk")).toBe(false);
    expect(b.md()).toBe("Buy egxgs today\n");
  });

  test("a second replace changes what the first one wrote, and the words sent are the new ones", () => {
    const a = viewOf("Buy eggs today\n", "eggs"), h = hold(a.v)!;
    h.replace("*milk*");
    expect(h.markdown()).toBe("*milk*");
    expect(h.replace("bread")).toBe(true);
    expect(a.md()).toBe("Buy bread today\n");
  });

  test("insertAfter adds blocks under the top-level block the words end in", () => {
    const a = viewOf("- one\n- two\n\nafter\n", "one");
    expect(hold(a.v)!.insertAfter("A summary.")).toBe(true);
    expect(a.md()).toBe("- one\n- two\n\nA summary.\n\nafter\n");
    expect(hold(viewOf("x\n", "x").v)!.insertAfter("")).toBe(false);
  });

  test("undo takes the change back while nothing was typed since", () => {
    const a = viewOf("Buy eggs today\n", "eggs"), h = hold(a.v)!;
    h.replace("milk");
    expect(h.canUndo()).toBe(true);
    expect(h.undo()).toBe(true);
    expect(a.md()).toBe("Buy eggs today\n");
    expect(h.replace("bread")).toBe(true);                    // the words are back, and held again
    a.type(1, "Go. ");
    expect(h.canUndo()).toBe(false);
  });

  test("released, it changes nothing", () => {
    const a = viewOf("Buy eggs today\n", "eggs"), h = hold(a.v)!;
    h.release();
    expect(h.replace("milk")).toBe(false);
    expect(a.md()).toBe("Buy eggs today\n");
  });
});
