// The note pane's format tools (bold, italic, checklist, link, and the rest under ⋯), the one set of editing tools:
// they sit in the pane's top bar (on a phone, in a bar on top of the keyboard), driven by the editor instance the body hands up. A mousedown on a tool is
// prevented, so the editor keeps its selection and focus.
import {
  Bold, Code, CodeXml, Italic, Link2, List, ListOrdered, ListTodo, Minus, Quote, Redo2, Strikethrough, Table2, Undo2, type LucideIcon,
  Heading1, Heading2, Heading3, Ellipsis, Plus, Trash2, ArrowUp, ArrowDown,
} from "lucide-react";
import { useEffect, useReducer, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CommandName, Editor } from "@/editor";

const GROUPS: { name: CommandName; label: string; icon: LucideIcon }[][] = [
  [
    { name: "bold", label: "Bold", icon: Bold }, { name: "italic", label: "Italic", icon: Italic },
    { name: "strike", label: "Strikethrough", icon: Strikethrough }, { name: "code", label: "Code", icon: Code },
  ],
  [
    { name: "heading1", label: "Heading 1", icon: Heading1 }, { name: "heading2", label: "Heading 2", icon: Heading2 },
    { name: "heading3", label: "Heading 3", icon: Heading3 },
  ],
  [
    { name: "bulletList", label: "Bulleted list", icon: List }, { name: "orderedList", label: "Numbered list", icon: ListOrdered },
    { name: "taskList", label: "Checklist", icon: ListTodo }, { name: "blockquote", label: "Quote", icon: Quote },
    { name: "codeBlock", label: "Code block", icon: CodeXml }, { name: "table", label: "Table", icon: Table2 },
    { name: "rule", label: "Divider", icon: Minus },
  ],
  [{ name: "undo", label: "Undo", icon: Undo2 }, { name: "redo", label: "Redo", icon: Redo2 }],
];

const MOVE: { name: CommandName; label: string; icon: LucideIcon }[] = [
  { name: "moveUp", label: "Move item up (Alt+↑)", icon: ArrowUp }, { name: "moveDown", label: "Move item down (Alt+↓)", icon: ArrowDown },
];

const TABLE: { name: CommandName; label: string; icon: LucideIcon }[] = [
  { name: "addRow", label: "Add row below", icon: Plus }, { name: "addColumn", label: "Add column after", icon: Plus },
  { name: "deleteRow", label: "Delete row", icon: Trash2 }, { name: "deleteColumn", label: "Delete column", icon: Trash2 },
  { name: "deleteTable", label: "Delete table", icon: Trash2 },
];

function Tool({ label, pressed, onRun, children }: { label: string; pressed?: boolean; onRun: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle size="sm" aria-label={label} pressed={pressed ?? false} onMouseDown={(e) => e.preventDefault()} onPressedChange={onRun}>{children}</Toggle>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function LinkTool({ editor, side }: { editor: Editor; side: "top" | "bottom" }) {
  const [open, setOpen] = useState(false), [href, setHref] = useState("");
  const on = editor.isActive("link");
  const apply = () => {
    const v = href.trim();
    if (v) editor.run("link", v);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={(o) => { if (o && on) { editor.run("link"); return; } setHref(""); setOpen(o); }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Toggle size="sm" aria-label={on ? "Remove link" : "Link"} pressed={on} onMouseDown={(e) => e.preventDefault()}><Link2 /></Toggle>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{on ? "Remove link" : "Link"}</TooltipContent>
      </Tooltip>
      <PopoverContent side={side} align="start" className="w-72">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); apply(); }}>
          <Input autoFocus value={href} onChange={(e) => setHref(e.target.value)} placeholder="https://…" aria-label="Link address" />
          <Button type="submit" size="sm" className="rounded-full">Link</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** The format tools in the note bar: the few used most, the rest under ⋯. Redraws with the editor's state. */
export function FormatTools({ editor, side = "bottom" }: { editor: Editor; side?: "top" | "bottom" }) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => editor.subscribe(redraw), [editor]);
  const primary: CommandName[] = ["bold", "italic", "taskList"];
  const commands = GROUPS.flat();
  return (
    <div role="toolbar" aria-label="Format" className="flex items-center gap-0.5 text-dim">
      {commands.filter(({ name }) => primary.includes(name)).map(({ name, label, icon: Icon }) => (
        <Tool key={name} label={label} pressed={editor.isActive(name)} onRun={() => editor.run(name)}><Icon /></Tool>
      ))}
      <LinkTool editor={editor} side={side} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="More formatting" onMouseDown={(e) => e.preventDefault()}><Ellipsis /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side={side} align="start" className="w-52 max-h-[60dvh] overflow-y-auto" onCloseAutoFocus={(e) => { e.preventDefault(); editor.focus(); }}>
          {GROUPS.map((group, i) => (
            <div key={i}>
              {i > 0 ? <DropdownMenuSeparator /> : null}
              {group.filter(({ name }) => !primary.includes(name)).map(({ name, label, icon: Icon }) => (
                <DropdownMenuItem key={name} onSelect={() => editor.run(name)}><Icon />{label}</DropdownMenuItem>
              ))}
            </div>
          ))}
          {editor.canMove() ? (
            <>
              <DropdownMenuSeparator />
              {MOVE.map(({ name, label, icon: Icon }) => (
                <DropdownMenuItem key={name} onSelect={() => editor.run(name)}><Icon />{label}</DropdownMenuItem>
              ))}
            </>
          ) : null}
          {editor.inTable() ? (
            <>
              <DropdownMenuSeparator />
              {TABLE.map(({ name, label, icon: Icon }) => (
                <DropdownMenuItem key={name} onSelect={() => editor.run(name)}><Icon />{label}</DropdownMenuItem>
              ))}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
