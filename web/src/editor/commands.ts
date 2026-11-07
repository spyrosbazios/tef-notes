// What the editor can do: the commands behind the toolbar and the keys, the markdown shortcuts typed in place
// (`# `, `- [ ] `, `**bold**`) and the keymap. No view lives here, only transformations of a state.
import { baseKeymap, chainCommands, createParagraphNear, lift, liftEmptyBlock, newlineInCode, setBlockType, splitBlock, toggleMark, wrapIn } from "prosemirror-commands";
import { InputRule, inputRules, textblockTypeInputRule, undoInputRule, wrappingInputRule } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import type { MarkType, NodeType } from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem, wrapInList } from "prosemirror-schema-list";
import { Selection, TextSelection } from "prosemirror-state";
import type { Command, EditorState, Transaction } from "prosemirror-state";
import {
  addColumnAfter, addRowAfter, deleteColumn, deleteRow, deleteTable, goToNextCell, isInTable,
} from "prosemirror-tables";
import { redo, undo } from "prosemirror-history";
import { schema } from "./markdown";

const { paragraph, heading, blockquote, code_block, bullet_list, ordered_list, list_item, horizontal_rule, hard_break, table, table_row, table_cell, table_header } = schema.nodes;
const { strong, em, strike, code, link } = schema.marks;

export type CommandName =
  | "bold" | "italic" | "strike" | "code" | "link"
  | "heading1" | "heading2" | "heading3" | "bulletList" | "orderedList" | "taskList" | "blockquote" | "codeBlock" | "rule" | "table"
  | "moveUp" | "moveDown" | "undo" | "redo" | "addRow" | "addColumn" | "deleteRow" | "deleteColumn" | "deleteTable";

// ---- where the selection is

/** The nearest ancestor of the selection's start that is `type`, with its depth. */
function up(state: EditorState, type: NodeType): { depth: number } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === type) return { depth: d };
  return null;
}

export function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  return empty ? !!type.isInSet(state.storedMarks ?? $from.marks()) : state.doc.rangeHasMark(from, to, type);
}

/** The href of the link at the selection, or null. */
export function linkAt(state: EditorState): string | null {
  const { $from, from, to, empty } = state.selection;
  if (empty) return link.isInSet(state.storedMarks ?? $from.marks())?.attrs.href ?? null;
  let href: string | null = null;
  state.doc.nodesBetween(from, to, (n) => { const m = link.isInSet(n.marks); if (m && href === null) href = m.attrs.href; });
  return href;
}

/** The list item the cursor is in is a checklist item: a task is a bullet list's item with `checked` set. */
function inTask(state: EditorState): boolean {
  const i = up(state, list_item);
  return !!i && state.selection.$from.node(i.depth).attrs.checked != null;
}

export function isActive(state: EditorState, name: CommandName): boolean {
  const { parent } = state.selection.$from;
  switch (name) {
    case "bold": return markActive(state, strong);
    case "italic": return markActive(state, em);
    case "strike": return markActive(state, strike);
    case "code": return markActive(state, code);
    case "link": return linkAt(state) !== null;
    case "heading1": case "heading2": case "heading3": return parent.type === heading && parent.attrs.level === Number(name.slice(-1));
    case "bulletList": return !!up(state, bullet_list) && !inTask(state);
    case "orderedList": return !!up(state, ordered_list);
    case "taskList": return inTask(state);
    case "blockquote": return !!up(state, blockquote);
    case "codeBlock": return parent.type === code_block;
    default: return false;
  }
}

// ---- commands

const toggleBlock = (type: NodeType, attrs: Record<string, unknown> = {}): Command => (state, dispatch) => {
  const { parent } = state.selection.$from, on = parent.type === type && Object.entries(attrs).every(([k, v]) => parent.attrs[k] === v);
  return (on ? setBlockType(paragraph) : setBlockType(type, attrs))(state, dispatch);
};

const toggleWrap = (type: NodeType): Command => (state, dispatch) => (up(state, type) ? lift(state, dispatch) : wrapIn(type)(state, dispatch));

const toggleList = (type: NodeType): Command => (state, dispatch) => {
  if (up(state, type)) return liftListItem(list_item)(state, dispatch);
  return wrapInList(type)(state, dispatch);
};

/** Bullets: a checklist item becomes a plain bullet (the checklist is not the bullet list, so the tool is off there); otherwise as any list. */
const toggleBullets: Command = (state, dispatch) => {
  const item = up(state, list_item);
  if (!item || !inTask(state) || !up(state, bullet_list)) return toggleList(bullet_list)(state, dispatch);
  if (dispatch) dispatch(state.tr.setNodeMarkup(state.selection.$from.before(item.depth), undefined, { ...state.selection.$from.node(item.depth).attrs, checked: null }));
  return true;
};

/** Make the item the cursor is in a task (unchecked), or a plain item again; outside a list, start a task list. */
const toggleTask: Command = (state, dispatch, view) => {
  const item = up(state, list_item);
  if (!item) {
    if (!wrapInList(bullet_list)(state, dispatch)) return false;
    if (view) return toggleTask(view.state, view.dispatch, view);
    return true;
  }
  if (dispatch) {
    const node = state.selection.$from.node(item.depth), at = state.selection.$from.before(item.depth);
    dispatch(state.tr.setNodeMarkup(at, undefined, { ...node.attrs, checked: node.attrs.checked == null ? false : null }));
  }
  return true;
};

/** Swap the list item the cursor is in (bullet, checklist or numbered; with what is nested under it) with the one above
 *  or below it in the same list. The cursor moves with it. */
const moveItem = (dir: 1 | -1): Command => (state, dispatch) => {
  const item = up(state, list_item);
  if (!item) return false;
  const { $from, $to } = state.selection, list = $from.node(item.depth - 1), i = $from.index(item.depth - 1), j = i + dir;
  if (j < 0 || j >= list.childCount) return false;
  if (dispatch) {
    const self = list.child(i), other = list.child(j), at = $from.before(item.depth);
    const from = dir === 1 ? at : at - other.nodeSize, shift = dir === 1 ? other.nodeSize : -other.nodeSize;
    const tr = state.tr.replaceWith(from, from + self.nodeSize + other.nodeSize, dir === 1 ? [other, self] : [self, other]);
    dispatch(tr.setSelection(TextSelection.create(tr.doc, $from.pos + shift, $to.pos + shift)).scrollIntoView());
  }
  return true;
};

const insertRule: Command = (state, dispatch) => {
  if (dispatch) dispatch(state.tr.replaceSelectionWith(horizontal_rule.create()).scrollIntoView());
  return true;
};

/** A 3 x 3 table, header row first, the cursor in its first cell. */
const insertTable: Command = (state, dispatch) => {
  if (isInTable(state)) return false;
  if (dispatch) {
    const row = (cell: NodeType) => table_row.create(null, [0, 1, 2].map(() => cell.createAndFill()!));
    const node = table.create(null, [row(table_header), row(table_cell), row(table_cell)]);
    const tr = state.tr.replaceSelectionWith(node);
    const first = tr.mapping.map(state.selection.from) + 1;
    dispatch(tr.setSelection(Selection.near(tr.doc.resolve(first))).scrollIntoView());
  }
  return true;
};

/** `href` over the selection (or as its own text with no selection); null takes the link off. */
export function setLink(href: string | null): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (!dispatch) return true;
    const tr = state.tr;
    if (href === null) {
      let a = from, b = to;
      if (empty) { const $f = state.selection.$from, node = $f.parent.childAfter($f.parentOffset), start = $f.start() + node.offset; a = start; b = start + (node.node?.nodeSize ?? 0); }
      tr.removeMark(a, b, link);
    } else if (empty) {
      tr.replaceSelectionWith(schema.text(href, [link.create({ href, markup: "linkify" })]), false);
    } else tr.addMark(from, to, link.create({ href }));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

export const commands: Record<Exclude<CommandName, "link">, Command> = {
  bold: toggleMark(strong), italic: toggleMark(em), strike: toggleMark(strike), code: toggleMark(code),
  heading1: toggleBlock(heading, { level: 1 }), heading2: toggleBlock(heading, { level: 2 }), heading3: toggleBlock(heading, { level: 3 }),
  bulletList: toggleBullets, orderedList: toggleList(ordered_list), taskList: toggleTask,
  blockquote: toggleWrap(blockquote), codeBlock: toggleBlock(code_block), rule: insertRule, table: insertTable,
  moveUp: moveItem(-1), moveDown: moveItem(1), undo, redo,
  addRow: addRowAfter, addColumn: addColumnAfter, deleteRow, deleteColumn, deleteTable,
};

// ---- keys

const hardBreak: Command = (state, dispatch) => {
  if (!state.selection.$from.parent.canReplaceWith(state.selection.$from.index(), state.selection.$from.index(), hard_break)) return false;
  if (dispatch) dispatch(state.tr.replaceSelectionWith(hard_break.create()).scrollIntoView());
  return true;
};

/** Enter in a table cell (one line of inline content) is a line break; there is no second paragraph to go to. */
const enterInCell: Command = (state, dispatch) => (isInTable(state) ? hardBreak(state, dispatch) : false);

/** A line of three backticks and an optional language, then Enter, opens a code block. */
const fenceOnEnter: Command = (state, dispatch) => {
  const { $from } = state.selection, m = /^```([\w+#.-]*)$/.exec($from.parent.textContent);
  if (!m || $from.parent.type !== paragraph || !state.selection.empty) return false;
  if (dispatch) {
    const tr = state.tr.delete($from.start(), $from.end()).setBlockType($from.start(), $from.start(), code_block, { params: m[1] });
    dispatch(tr.scrollIntoView());
  }
  return true;
};

const inList: Command = (state) => !!up(state, list_item);

/** Tab: deeper in a list, the next cell in a table; elsewhere Tab keeps its job of leaving the editor. */
const tab = (dir: 1 | -1): Command => chainCommands(
  (state, dispatch) => (dir === 1 ? sinkListItem(list_item)(state, dispatch) || inList(state) : liftListItem(list_item)(state, dispatch) || inList(state)),
  goToNextCell(dir),
);

const heading0: Command = setBlockType(paragraph);

export const keys = keymap({
  "Mod-b": commands.bold, "Mod-i": commands.italic, "Mod-e": commands.code, "Mod-Shift-x": commands.strike,
  "Mod-Alt-0": heading0, "Mod-Alt-1": commands.heading1, "Mod-Alt-2": commands.heading2, "Mod-Alt-3": commands.heading3,
  "Mod-Shift-7": commands.orderedList, "Mod-Shift-8": commands.bulletList, "Mod-Shift-9": commands.taskList,
  "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo,
  Enter: chainCommands(enterInCell, fenceOnEnter, splitListItem(list_item), newlineInCode, createParagraphNear, liftEmptyBlock, splitBlock),
  "Shift-Enter": hardBreak, "Mod-Enter": hardBreak,
  "Alt-ArrowUp": commands.moveUp, "Alt-ArrowDown": commands.moveDown,
  Tab: tab(1), "Shift-Tab": tab(-1),
  Backspace: chainCommands(undoInputRule, baseKeymap.Backspace),
});

export const base = keymap(baseKeymap);

// ---- typed shortcuts

/** `**x**` and friends: the closing mark typed turns the text between into the mark. */
function markRule(re: RegExp, type: MarkType): InputRule {
  return new InputRule(re, (state, match, start, end) => {
    const inner = match[1], open = match[0].indexOf(inner), from = start + open, to = from + inner.length, tr = state.tr;
    if (to < end) tr.delete(to, end);
    if (open > 0) tr.delete(start, from);
    return tr.addMark(start, start + inner.length, type.create()).removeStoredMark(type);
  });
}

/** `[ ] ` or `[x] ` at the start of a list item makes it a task. */
const taskRule = new InputRule(/^\[([ xX]?)\]\s$/, (state, match, start, end) => {
  const $s = state.doc.resolve(start);
  if ($s.parent.type !== paragraph || $s.depth < 2 || $s.node(-1).type !== list_item || $s.index(-1) !== 0 || $s.node(-1).attrs.checked != null) return null;
  const item = $s.node(-1);
  return state.tr.delete(start, end).setNodeMarkup($s.before(-1), undefined, { ...item.attrs, checked: match[1] === "x" || match[1] === "X" });
});

const ruleRule = new InputRule(/^(?:---|___)$/, (state, _match, start, end) => {
  const tr: Transaction = state.tr.delete(start, end);
  return tr.replaceSelectionWith(horizontal_rule.create());
});

export const typed = inputRules({
  rules: [
    textblockTypeInputRule(/^(#{1,6})\s$/, heading, (m) => ({ level: m[1].length })),
    wrappingInputRule(/^\s*>\s$/, blockquote),
    wrappingInputRule(/^\s*([-+*])\s$/, bullet_list, (m) => ({ marker: m[1] })),
    wrappingInputRule(/^(\d+)\.\s$/, ordered_list, (m) => ({ order: Number(m[1]) }), (m, node) => node.childCount + node.attrs.order === Number(m[1])),
    textblockTypeInputRule(/^```([\w+#.-]*)\s$/, code_block, (m) => ({ params: m[1] })),
    taskRule, ruleRule,
    markRule(/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, strong),
    markRule(/(?<![*\w])\*([^*\s](?:[^*]*[^*\s])?)\*$/, em),
    markRule(/(?<![_\w])_([^_\s](?:[^_]*[^_\s])?)_$/, em),
    markRule(/~~([^~\s](?:[^~]*[^~\s])?)~~$/, strike),
    markRule(/`([^`]+)`$/, code),
  ],
});
