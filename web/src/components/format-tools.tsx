// The note pane's format tools, the one set of editing tools, each where this layout's preferences put it (core/format-tools.ts,
// `phone.formatTools`, `desktop.formatTools`; set in Settings → Notes): in the bar, under ⋯, or off. On the desktop they sit in
// the pane's top bar, where a narrow bar keeps its first few and moves the rest under ⋯; on a phone, in a bar on top of the
// keyboard with no menu. The contextual tools (moving a list item, a table's rows and columns) join where they apply. Driven by
// the editor instance the body hands up; a mousedown on a tool is prevented, so the editor keeps its selection and focus.
import { ArrowDown, ArrowUp, Ellipsis, Link2, Plus, Trash2, type LucideIcon } from "lucide-react";
import { Fragment, useEffect, useReducer, useState } from "react";
import { TOOL_ICON } from "@/components/format-tool-icons";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FORMAT_TOOL_LABEL, narrowBar, TOOL_GROUP, toolsAt, type FormatTool } from "@/core/format-tools";
import type { CommandName, Editor } from "@/editor";
import { useLayout } from "@/hooks/media";
import { usePrefs } from "@/hooks/prefs";
import { cn } from "@/lib/utils";

const MOVE: { name: CommandName; label: string; icon: LucideIcon }[] = [
  { name: "moveUp", label: "Move item up (Alt+↑)", icon: ArrowUp }, { name: "moveDown", label: "Move item down (Alt+↓)", icon: ArrowDown },
];

const TABLE: { name: CommandName; label: string; icon: LucideIcon }[] = [
  { name: "addRow", label: "Add row below", icon: Plus }, { name: "addColumn", label: "Add column after", icon: Plus },
  { name: "deleteRow", label: "Delete row", icon: Trash2 }, { name: "deleteColumn", label: "Delete column", icon: Trash2 },
  { name: "deleteTable", label: "Delete table", icon: Trash2 },
];

const Divider = () => <div className="mx-1 h-5 w-px shrink-0 bg-line" />;

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

/** The bar's own label: the shadcn tooltip. */
function defaultLabel(text: string, toggle: React.ReactElement) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{toggle}</TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

/** Link or unlink the selection: a toggle that opens a field for the address. `onOpenChange`: the field shows or goes
 *  (the bar over a selection stays up while it has the focus). `label`: wraps the toggle in its label. */
export function LinkTool({ editor, side, onOpenChange, label = defaultLabel }: {
  editor: Editor; side: "top" | "bottom"; onOpenChange?: (open: boolean) => void;
  label?: (text: string, toggle: React.ReactElement) => React.ReactNode;
}) {
  const [open, setOpenState] = useState(false), [href, setHref] = useState("");
  const setOpen = (o: boolean) => { setOpenState(o); onOpenChange?.(o); };
  const on = editor.isActive("link");
  const apply = () => {
    const v = href.trim();
    if (v) editor.run("link", v);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={(o) => { if (o && on) { editor.run("link"); return; } setHref(""); setOpen(o); }}>
      {label(on ? "Remove link" : "Link", (
        <PopoverTrigger asChild>
          <Toggle size="sm" aria-label={on ? "Remove link" : "Link"} pressed={on} onMouseDown={(e) => e.preventDefault()}><Link2 /></Toggle>
        </PopoverTrigger>
      ))}
      <PopoverContent side={side} align="start" className="w-72">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); apply(); }}>
          <Input autoFocus value={href} onChange={(e) => setHref(e.target.value)} placeholder="https://…" aria-label="Link address" />
          <Button type="submit" size="sm" className="rounded-full">Link</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** The format tools in the note bar, as this layout's preferences place them. Redraws with the editor's state. */
export function FormatTools({ editor, side = "bottom" }: { editor: Editor; side?: "top" | "bottom" }) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => editor.subscribe(redraw), [editor]);
  const layout = useLayout(), slots = usePrefs()[layout].formatTools;
  const extra = [...(editor.canMove() ? MOVE : []), ...(editor.inTable() ? TABLE : [])];

  const tool = (id: FormatTool) => {
    if (id === "link") return <LinkTool key={id} editor={editor} side={side} />;
    const Icon = TOOL_ICON[id];
    return <Tool key={id} label={FORMAT_TOOL_LABEL[id]} pressed={editor.isActive(id)} onRun={() => editor.run(id)}><Icon /></Tool>;
  };
  // The bar's tools in order, a divider where the kind changes, then the contextual ones
  const row = (ids: FormatTool[], className?: string, more?: React.ReactNode) => (
    <div role="toolbar" aria-label="Format" className={cn("flex shrink-0 items-center gap-0.5 text-dim", className)}>
      {ids.map((id, i) => (
        <Fragment key={id}>
          {i > 0 && TOOL_GROUP[ids[i - 1]] !== TOOL_GROUP[id] ? <Divider /> : null}
          {tool(id)}
        </Fragment>
      ))}
      {more}
    </div>
  );
  const extras = extra.length ? (
    <>
      <Divider />
      {extra.map(({ name, label, icon: Icon }) => <Tool key={name} label={label} onRun={() => editor.run(name)}><Icon /></Tool>)}
    </>
  ) : null;

  // The bar on top of a phone's keyboard: one scrolling row, no menu (it would take the focus and drop the keyboard)
  if (layout === "phone") return row(toolsAt(slots, "bar"), undefined, extras);

  const menu = (ids: FormatTool[], withExtra: boolean) => {
    const groups = ids.reduce<FormatTool[][]>((gs, id, i) => {
      if (i > 0 && TOOL_GROUP[ids[i - 1]] === TOOL_GROUP[id]) gs[gs.length - 1].push(id); else gs.push([id]);
      return gs;
    }, []);
    const contextual = withExtra ? [editor.canMove() ? MOVE : [], editor.inTable() ? TABLE : []].filter((g) => g.length) : [];
    if (!groups.length && !contextual.length) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="More formatting" onMouseDown={(e) => e.preventDefault()}><Ellipsis /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side={side} align="start" className="w-52 max-h-[60dvh] overflow-y-auto" onCloseAutoFocus={(e) => { e.preventDefault(); editor.focus(); }}>
          {groups.map((g, i) => (
            <div key={g[0]}>
              {i > 0 ? <DropdownMenuSeparator /> : null}
              {g.map((id) => {
                if (id === "link") return null;
                const Icon = TOOL_ICON[id];
                return <DropdownMenuItem key={id} onSelect={() => editor.run(id)}><Icon />{FORMAT_TOOL_LABEL[id]}</DropdownMenuItem>;
              })}
            </div>
          ))}
          {contextual.map((g, i) => (
            <div key={i}>
              {groups.length || i > 0 ? <DropdownMenuSeparator /> : null}
              {g.map(({ name, label, icon: Icon }) => <DropdownMenuItem key={name} onSelect={() => editor.run(name)}><Icon />{label}</DropdownMenuItem>)}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };
  // In the top bar: the bar's tools in a row when the bar is wide enough (a container query on the bar), else its first few,
  // the rest under ⋯ with the menu's own and the contextual ones
  const narrow = narrowBar(slots);
  return (
    <>
      {row(toolsAt(slots, "bar"), "hidden @5xl:flex", <>{extras}{menu(toolsAt(slots, "menu"), false)}</>)}
      {row(narrow.bar, "@5xl:hidden", menu(narrow.menu, true))}
    </>
  );
}
