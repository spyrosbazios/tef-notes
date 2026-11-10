// The slash menu: `/` typed at a line's start or after a space opens a list of blocks to turn the line into (headings,
// lists, a divider, a table…); typing filters it, arrows and Enter or a click pick, Escape or a space closes it. The
// picked item's `/query` is deleted, then the toolbar's own command runs (./commands). Plain DOM, like the rest.
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { commands } from "./commands";
import type { CommandName } from "./commands";

export type SlashItem = { name: Exclude<CommandName, "link">; label: string; hint: string; words: string };

export const SLASH_ITEMS: SlashItem[] = [
  { name: "paragraph", label: "Text", hint: "Plain paragraph", words: "text paragraph plain" },
  { name: "heading1", label: "Heading 1", hint: "#", words: "h1 heading title big" },
  { name: "heading2", label: "Heading 2", hint: "##", words: "h2 heading subtitle" },
  { name: "heading3", label: "Heading 3", hint: "###", words: "h3 heading small" },
  { name: "bulletList", label: "Bulleted list", hint: "-", words: "bullet list ul unordered" },
  { name: "orderedList", label: "Numbered list", hint: "1.", words: "numbered ordered list ol" },
  { name: "taskList", label: "Todo list", hint: "[ ]", words: "todo task checkbox check list" },
  { name: "blockquote", label: "Quote", hint: ">", words: "quote blockquote citation" },
  { name: "codeBlock", label: "Code block", hint: "```", words: "code block pre snippet" },
  { name: "rule", label: "Divider", hint: "---", words: "divider rule hr line separator" },
  { name: "table", label: "Table", hint: "3×3", words: "table grid" },
];

/** The items matching `query`: every word typed is the start of a word of the item's label or keywords. */
export function slashMatches(query: string): SlashItem[] {
  const q = query.toLowerCase().trim();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter((i) => `${i.label} ${i.words}`.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)));
}

/** The open `/query` before the cursor: where its slash is and what follows. Null outside text, in code, or with a selection. */
export function slashAt(state: EditorState): { from: number; query: string } | null {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parent.type.spec.code) return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
  const m = /(?:^|\s)\/([\p{L}\d-]{0,20})$/u.exec(before);
  return m ? { from: $from.pos - m[1].length - 1, query: m[1] } : null;
}

const key = new PluginKey<{ index: number; closedAt: number | null }>("slash");

/** Delete the `/query` and run the item's command on the line. */
export function pickSlash(view: EditorView, item: SlashItem): boolean {
  const at = slashAt(view.state);
  if (!at) return false;
  view.dispatch(view.state.tr.delete(at.from, view.state.selection.from));
  commands[item.name](view.state, view.dispatch, view);
  view.focus();
  return true;
}

export const slashMenu = new Plugin<{ index: number; closedAt: number | null }>({
  key,
  state: {
    init: () => ({ index: 0, closedAt: null }),
    apply(tr, prev, _old, state) {
      const meta = tr.getMeta(key) as Partial<{ index: number; closedAt: number | null }> | undefined;
      const at = slashAt(state);
      // A new `/` (somewhere else) opens again after Escape; the same one stays closed while its query is typed
      const closedAt = meta && "closedAt" in meta ? meta.closedAt ?? null : at && prev.closedAt === at.from ? prev.closedAt : null;
      const index = meta?.index ?? (tr.docChanged ? 0 : prev.index);
      return { index, closedAt };
    },
  },
  props: {
    handleKeyDown(view, e) {
      const open = openMenu(view.state);
      if (!open) return false;
      const { items, index } = open;
      const move = (to: number) => { view.dispatch(view.state.tr.setMeta(key, { index: (to + items.length) % items.length })); return true; };
      if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) return move(index + 1);
      if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) return move(index - 1);
      if (e.key === "Enter" || e.key === "Tab") return pickSlash(view, items[index]);
      if (e.key === "Escape") { view.dispatch(view.state.tr.setMeta(key, { closedAt: open.from })); return true; }
      return false;
    },
  },
  view: (view) => new SlashView(view),
});

/** The menu's items and highlighted one when it shows. */
function openMenu(state: EditorState) {
  const at = slashAt(state), s = key.getState(state);
  if (!at || !s || s.closedAt === at.from) return null;
  const items = slashMatches(at.query);
  return items.length ? { from: at.from, items, index: Math.min(s.index, items.length - 1) } : null;
}

class SlashView {
  private dom = document.createElement("div");
  private shown = "";

  constructor(private view: EditorView) {
    this.dom.className = "pm-slash";
    this.dom.setAttribute("role", "listbox");
    this.dom.hidden = true;
    // A press on the menu must not take the focus (and the selection) from the editor
    this.dom.addEventListener("mousedown", (e) => e.preventDefault());
    document.body.append(this.dom);
    view.dom.addEventListener("blur", this.refresh);
    view.dom.addEventListener("focus", this.refresh);
    this.update(view);
  }

  update(view: EditorView) {
    this.view = view;
    const open = view.hasFocus() || this.dom.contains(document.activeElement) ? openMenu(view.state) : null;
    if (!open) { this.dom.hidden = true; this.shown = ""; return; }
    const sig = open.items.map((i) => i.name).join() + open.index;
    if (sig !== this.shown) {
      this.shown = sig;
      this.dom.replaceChildren(...open.items.map((item, i) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "pm-slash-item";
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", String(i === open.index));
        const label = document.createElement("span"), hint = document.createElement("span");
        label.textContent = item.label;
        hint.className = "pm-slash-hint";
        hint.textContent = item.hint;
        row.append(label, hint);
        row.addEventListener("click", () => pickSlash(this.view, item));
        return row;
      }));
      this.dom.children[open.index]?.scrollIntoView({ block: "nearest" });
    }
    this.dom.hidden = false;
    const at = view.coordsAtPos(open.from), h = this.dom.offsetHeight, w = this.dom.offsetWidth;
    const below = at.bottom + 4 + h <= window.innerHeight || at.top - 4 - h < 0;
    this.dom.style.top = `${below ? at.bottom + 4 : at.top - 4 - h}px`;
    this.dom.style.left = `${Math.max(8, Math.min(at.left, window.innerWidth - w - 8))}px`;
  }

  private refresh = () => this.update(this.view);

  destroy() {
    this.view.dom.removeEventListener("blur", this.refresh);
    this.view.dom.removeEventListener("focus", this.refresh);
    this.dom.remove();
  }
}
