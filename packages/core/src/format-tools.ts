// The note editor's format tools (bold, headings, lists, undo...) and where each sits, a layout's own (prefs `phone.formatTools`,
// `desktop.formatTools`): a `ToolSlot` each, in the owner's order, in the bar, under its ⋯ menu, or off.
//   - The desktop's bar sits at the left of the note's top bar. When that bar is narrow, the first `NARROW_BAR` of its tools
//     stay and the rest join the menu's (`narrowBar`).
//   - Link asks for an address in a field beside its button, so it is never a menu's: in the bar (always, however narrow) or off.
//   - The phone's rides on top of the keyboard and has no menu: a menu would take the focus from the editor, which drops the
//     keyboard and the bar with it. A tool there is in the bar or off (`placesFor`).
// The contextual tools (moving a list item, a table's rows and columns) show where they apply and are no slot's.
// Pure and platform-neutral: a client draws each tool by its name from its own icon set.

type LayoutName = "phone" | "desktop";

export const FORMAT_TOOLS = [
  "bold", "italic", "strike", "code", "link", "heading1", "heading2", "heading3",
  "bulletList", "orderedList", "taskList", "blockquote", "codeBlock", "table", "rule", "undo", "redo",
] as const;
export type FormatTool = (typeof FORMAT_TOOLS)[number];
export const FORMAT_TOOL_LABEL: Record<FormatTool, string> = {
  bold: "Bold", italic: "Italic", strike: "Strikethrough", code: "Code", link: "Link",
  heading1: "Heading 1", heading2: "Heading 2", heading3: "Heading 3",
  bulletList: "Bulleted list", orderedList: "Numbered list", taskList: "Checklist", blockquote: "Quote", codeBlock: "Code block",
  table: "Table", rule: "Divider", undo: "Undo", redo: "Redo",
};

/** Each tool's kind: the bar draws a divider where two neighbours are of different kinds. */
export const TOOL_GROUP: Record<FormatTool, "inline" | "heading" | "block" | "history"> = {
  bold: "inline", italic: "inline", strike: "inline", code: "inline", link: "inline",
  heading1: "heading", heading2: "heading", heading3: "heading",
  bulletList: "block", orderedList: "block", taskList: "block", blockquote: "block", codeBlock: "block", table: "block", rule: "block",
  undo: "history", redo: "history",
};

export const TOOL_PLACES = ["bar", "menu", "off"] as const;
type ToolPlace = (typeof TOOL_PLACES)[number];
export const TOOL_PLACE_LABEL: Record<ToolPlace, string> = { bar: "Bar", menu: "Menu", off: "Off" };

/** Where a tool can sit in a layout: the phone's bar has no menu, and Link is never a menu's. */
export const placesFor = (layout: LayoutName, tool: FormatTool): readonly ToolPlace[] =>
  (layout === "phone" || tool === "link" ? ["bar", "off"] : TOOL_PLACES);

/** How many of the desktop bar's tools stay in it when the note's top bar is narrow. */
export const NARROW_BAR = 4;

/** A format tool's place in one layout's editor. */
export type ToolSlot = { id: FormatTool; place: ToolPlace };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const isTool = (v: unknown): v is FormatTool => (FORMAT_TOOLS as readonly unknown[]).includes(v);

/** Whatever was stored as a layout's tools, whole: nothing stored is every tool in the bar; a stored list keeps its order and
 *  places, drops what is unknown, and adds a tool it doesn't know yet at the end (the desktop's menu, the phone's bar). A place
 *  the layout doesn't have is its bar. */
export function toolSlotsOf(raw: unknown, layout: LayoutName): ToolSlot[] {
  if (!Array.isArray(raw)) return FORMAT_TOOLS.map((id) => ({ id, place: "bar" }));
  const out: ToolSlot[] = [];
  for (const r of raw) {
    const s = obj(r);
    if (!isTool(s.id) || out.some((o) => o.id === s.id)) continue;
    out.push({ id: s.id, place: placesFor(layout, s.id).find((p) => p === s.place) ?? "bar" });
  }
  const fresh = (id: FormatTool): ToolPlace => (placesFor(layout, id).includes("menu") ? "menu" : "bar");
  return [...out, ...FORMAT_TOOLS.filter((id) => !out.some((o) => o.id === id)).map((id) => ({ id, place: fresh(id) }))];
}

/** The tools at `place`, in order. */
export const toolsAt = (slots: readonly ToolSlot[], place: ToolPlace): FormatTool[] => slots.filter((s) => s.place === place).map((s) => s.id);

/** The desktop bar's tools that stay when it is narrow: its first `NARROW_BAR`, and Link wherever it is. The rest of the bar
 *  goes under the menu, before the menu's own. */
export function narrowBar(slots: readonly ToolSlot[]): { bar: FormatTool[]; menu: FormatTool[] } {
  const bar = toolsAt(slots, "bar"), stay = bar.filter((id, i) => i < NARROW_BAR || id === "link");
  return { bar: stay, menu: [...bar.filter((id) => !stay.includes(id)), ...toolsAt(slots, "menu")] };
}
