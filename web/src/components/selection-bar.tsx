// The bar over selected words in a note: the tools the owner put in it (core/format-tools.ts, prefs `desktop.selectionBar`,
// Settings → Notes; by default the text's style, bold, italic, strikethrough, code, link and the assistant). It shows once a selection settles (a mouse released, a finger's handles let go, Shift and the arrows) and
// goes when it collapses, the editor loses the focus, or the words are in code. Over a mouse it floats above the words,
// and its labels are Animate UI's own Tooltip: one popup that glides from button to button. Under a finger it is the assistant's button alone (the bar over the keyboard has the format tools), below,
// clear of the selection's handles and of Android's own Copy and Paste menu above them, with no labels. A mousedown on a
// tool is prevented, so the editor keeps its selection and focus; the link's field and the style menu take the focus, so
// the bar stays while they are open. The assistant's button opens an ask about the words (selection-ask.tsx): on a laptop
// in the bar's place, under the words; on a phone as a sheet over the keyboard.
import { autoUpdate, flip, FloatingPortal, offset, shift, useFloating } from "@floating-ui/react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@animate-ui/react/primitives/tooltip";
import { scale, spring, useShouldReduceMotion, useTempoTransition } from "@animate-ui/react/utils/motion";
import { Check, ChevronDown, Heading1, Heading2, Heading3, Pilcrow, Sparkles, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Fragment, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { TOOL_ICON } from "@/components/format-tool-icons";
import { LinkTool } from "@/components/format-tools";
import { AskPanel, PhoneAsk } from "@/components/selection-ask";
import { useAskSession, useCloseOutside } from "@/hooks/ask-session";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Toggle } from "@/components/ui/toggle";
import { SELECTION_GROUP, SELECTION_TOOL_LABEL, shownTools, type SelectionTool } from "@/core/format-tools";
import type { CommandName, Editor } from "@/editor";
import { useModel } from "@/hooks/agent";
import { useHovers } from "@/hooks/hover";
import { useNarrow } from "@/hooks/media";
import { usePrefs } from "@/hooks/prefs";
import { keepFocus } from "@/lib/keys";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl+";
const ALT = MOD === "⌘" ? "⌥" : "Alt+";

/** The keyboard shortcut a tool's label shows (editor/commands.ts' keymap), where it has one. */
const KEYS: Partial<Record<SelectionTool, string>> = {
  bold: `${MOD}B`, italic: `${MOD}I`, strike: `${MOD}Shift+X`, code: `${MOD}E`,
  orderedList: `${MOD}Shift+7`, bulletList: `${MOD}Shift+8`, taskList: `${MOD}Shift+9`,
};

const STYLES: { name: CommandName; label: string; keys: string; icon: LucideIcon }[] = [
  { name: "paragraph", label: "Text", keys: `${MOD}${ALT}0`, icon: Pilcrow },
  { name: "heading1", label: "Heading 1", keys: `${MOD}${ALT}1`, icon: Heading1 },
  { name: "heading2", label: "Heading 2", keys: `${MOD}${ALT}2`, icon: Heading2 },
  { name: "heading3", label: "Heading 3", keys: `${MOD}${ALT}3`, icon: Heading3 },
];

/** A tool's label: the gliding tooltip under a mouse, nothing under a finger (a tap would leave it stuck open). */
function Label({ hovers, text, keys, children }: { hovers: boolean; text: string; keys?: string; children: React.ReactElement }) {
  if (!hovers) return children;
  return (
    <Tooltip side="top" sideOffset={8}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="z-50 flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-xs text-background">
        {text}{keys ? <Kbd className="bg-background/15 text-background">{keys}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}

/** The block's style: a menu of text and the three headings, its trigger the one the words are in. */
function StyleTool({ editor, hovers, below, onOpenChange }: { editor: Editor; hovers: boolean; below: boolean; onOpenChange: (open: boolean) => void }) {
  const current = STYLES.find((s) => editor.isActive(s.name)), Icon = current?.icon ?? Pilcrow;
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <Label hovers={hovers} text="Text style">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size={hovers ? "sm" : "lg"} aria-label={`Text style: ${current?.label ?? "Text"}`} className="gap-0.5 px-1.5 text-dim" onMouseDown={keepFocus}>
            <Icon /><ChevronDown className="size-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
      </Label>
      <DropdownMenuContent side={below ? "bottom" : "top"} align="start" className="w-48" onCloseAutoFocus={(e) => { e.preventDefault(); editor.focus(); }}>
        {STYLES.map(({ name, label, keys, icon: StyleIcon }) => (
          <DropdownMenuItem key={name} onSelect={() => editor.run(name)}>
            <StyleIcon />{label}
            <span className="ml-auto flex items-center gap-2">
              {hovers ? <span className="text-xs text-faint">{keys}</span> : null}
              {editor.isActive(name) ? <Check className="text-brand" /> : null}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SelectionBar({ editor }: { editor: Editor }) {
  const hovers = useHovers(), narrow = useNarrow(), reduce = useShouldReduceMotion(), { model } = useModel();
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [linking, setLinking] = useState(false), [styling, setStyling] = useState(false);
  useEffect(() => editor.subscribe(redraw), [editor]);
  const ask = useAskSession(editor);
  // A phone's bar is the assistant's button alone (the bar over the keyboard has the format tools)
  const shown = shownTools(usePrefs().desktop.selectionBar), tools: SelectionTool[] = narrow ? ["ask"] : shown;

  // The ask in the bar's place on a laptop (a phone's is a sheet). Otherwise the bar, for a settled selection, or while its
  // link field or style menu, opened from it, has the focus
  const asking = !!ask.session && !narrow;
  const open = asking || (!ask.session && tools.length > 0 && (!!editor.selectionBox() || linking || styling));

  // Read on every scroll and resize, so the bar follows the words (the held ones while asking: an answer may have changed
  // them); the last box stands in while the focus is elsewhere
  const last = useRef<DOMRect | null>(null), asked = useRef(asking);
  useEffect(() => { asked.current = asking; });
  const { refs: { setFloating, setPositionReference }, floatingStyles, update, isPositioned, placement } = useFloating({
    open,
    strategy: "fixed",
    // The ask's reply grows downward, under the words; the bar sits above them under a mouse, below them under a finger
    placement: asking || !hovers ? "bottom" : "top",
    // Under a finger, past the handles that hang below the selected line; the bigger tools are a fingertip's size. Words
    // taller than the window leave room on neither side: then it slides along them to stay on screen, over the words
    middleware: [offset(asking ? 10 : hovers ? 8 : 28), flip({ padding: 8 }), shift({ padding: 8, crossAxis: true })],
    whileElementsMounted: autoUpdate,
  });
  useLayoutEffect(() => {
    setPositionReference({
      getBoundingClientRect: () => (last.current = (asked.current ? editor.heldBox() : editor.selectionBox()) ?? last.current ?? new DOMRect()),
      contextElement: editor.dom,
    });
  }, [setPositionReference, editor]);
  // A new selection moves the reference without a scroll or resize autoUpdate would see
  useLayoutEffect(() => { if (open) update(); });

  const panel = useRef<HTMLDivElement>(null);
  useCloseOutside(panel, asking ? ask.session : null, ask.close);

  const enter = useTempoTransition(spring.pop);
  const hidden = { opacity: 0, scale: reduce ? 1 : scale.popover };
  const below = placement.startsWith("bottom");
  const pop = { initial: hidden, animate: { opacity: 1, scale: 1, transition: enter }, exit: { ...hidden, transition: enter }, style: { transformOrigin: below ? "50% 0%" : "50% 100%" } };
  const surface = "rounded-lg bg-popover text-dim shadow-md ring-1 ring-foreground/10";

  const tool = (id: SelectionTool) => {
    if (id === "style") return <StyleTool editor={editor} hovers={hovers} below={below} onOpenChange={setStyling} />;
    if (id === "link") return <LinkTool editor={editor} side={below ? "bottom" : "top"} onOpenChange={setLinking} label={(text, toggle) => <Label hovers={hovers} text={text}>{toggle}</Label>} />;
    if (id === "ask") return (
      <Label hovers={hovers} text={model ? SELECTION_TOOL_LABEL.ask : "The assistant is off: no model key"}>
        <Button variant="ghost" size={hovers ? "icon-sm" : "icon-lg"} aria-label="Ask the assistant about this" className="text-brand"
          disabled={!model} onMouseDown={keepFocus} onClick={() => ask.start()}>
          <Sparkles />
        </Button>
      </Label>
    );
    const Icon = TOOL_ICON[id], label = SELECTION_TOOL_LABEL[id];
    return (
      <Label hovers={hovers} text={label} keys={KEYS[id]}>
        <Toggle size={hovers ? "sm" : "lg"} aria-label={label} pressed={editor.isActive(id)} onMouseDown={keepFocus} onPressedChange={() => editor.run(id)}>
          <Icon />
        </Toggle>
      </Label>
    );
  };

  return (
    <>
      <FloatingPortal>
        <AnimatePresence>
          {open ? (
            <div key="float" ref={setFloating} style={floatingStyles} className="z-50">
              {isPositioned ? (
                <AnimatePresence mode="popLayout">
                  {asking && ask.session ? (
                    <motion.div key="ask" ref={panel} {...pop} className={`${surface} w-[26rem] max-w-[calc(100vw-1rem)] text-popover-foreground`}>
                      <AskPanel session={ask.session} send={ask.send} close={ask.close} carry={ask.carry} />
                    </motion.div>
                  ) : (
                    <motion.div key="bar" role="toolbar" aria-label="Format selection" {...pop} className={`${surface} flex items-center gap-0.5 p-1`}>
                      <TooltipProvider openDelay={400}>
                        {tools.map((id, i) => (
                          <Fragment key={id}>
                            {i > 0 && SELECTION_GROUP(tools[i - 1]) !== SELECTION_GROUP(id) ? <div className="mx-0.5 h-5 w-px bg-line" /> : null}
                            {tool(id)}
                          </Fragment>
                        ))}
                      </TooltipProvider>
                    </motion.div>
                  )}
                </AnimatePresence>
              ) : null}
            </div>
          ) : null}
        </AnimatePresence>
      </FloatingPortal>
      {narrow ? <PhoneAsk editor={editor} session={ask.session} send={ask.send} close={ask.close} carry={ask.carry} /> : null}
    </>
  );
}
