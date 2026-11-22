// The format tools' icons, by their names in core/format-tools.ts: the editor's bar and Settings → Notes draw the same.
import {
  Bold, Code, CodeXml, Heading1, Heading2, Heading3, Italic, Link2, List, ListOrdered, ListTodo, Minus, Quote, Redo2, Strikethrough, Table2, Undo2,
  type LucideIcon,
} from "lucide-react";
import type { FormatTool } from "@/core/format-tools";

/** Each tool's icon, by its name in core/format-tools.ts. */
export const TOOL_ICON: Record<FormatTool, LucideIcon> = {
  bold: Bold, italic: Italic, strike: Strikethrough, code: Code, link: Link2, heading1: Heading1, heading2: Heading2, heading3: Heading3,
  bulletList: List, orderedList: ListOrdered, taskList: ListTodo, blockquote: Quote, codeBlock: CodeXml, table: Table2, rule: Minus,
  undo: Undo2, redo: Redo2,
};
