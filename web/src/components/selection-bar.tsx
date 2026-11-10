// The bar over selected words in a note: bold, italic, strikethrough, code and link, at the selection itself. It shows once
// a selection settles (a mouse released, a finger's handles let go, Shift and the arrows) and goes when it collapses, the
// editor loses the focus, or the words are in code. Over a mouse it floats above the words, and its labels are Animate UI's
// own Tooltip: one popup that glides from button to button. Under a finger it sits below, clear of the selection's
// handles and of Android's own Copy and Paste menu above them, with no labels. A mousedown on a tool is prevented, so the
// editor keeps its selection and focus; the link's address field takes the focus, so the bar stays while it is open.
import { autoUpdate, flip, FloatingPortal, offset, shift, useFloating } from "@floating-ui/react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@animate-ui/react/primitives/tooltip";
import { scale, spring, useShouldReduceMotion, useTempoTransition } from "@animate-ui/react/utils/motion";
import { Bold, Code, Italic, Strikethrough, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { LinkTool } from "@/components/format-tools";
import { Kbd } from "@/components/ui/kbd";
import { Toggle } from "@/components/ui/toggle";
import type { CommandName, Editor } from "@/editor";
import { useHovers } from "@/hooks/hover";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl+";

const TOOLS: { name: CommandName; label: string; keys: string; icon: LucideIcon }[] = [
  { name: "bold", label: "Bold", keys: `${MOD}B`, icon: Bold },
  { name: "italic", label: "Italic", keys: `${MOD}I`, icon: Italic },
  { name: "strike", label: "Strikethrough", keys: `${MOD}Shift+X`, icon: Strikethrough },
  { name: "code", label: "Code", keys: `${MOD}E`, icon: Code },
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

export function SelectionBar({ editor }: { editor: Editor }) {
  const hovers = useHovers(), reduce = useShouldReduceMotion();
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [linking, setLinking] = useState(false);
  useEffect(() => editor.subscribe(redraw), [editor]);
  // The link field opens from the bar, so a selection was there; it takes the focus, and the bar stays while it is open
  const open = !!editor.selectionBox() || linking;

  // Read on every scroll and resize, so the bar follows the words; the last box stands in while the link field has the focus
  const held = useRef<DOMRect | null>(null);

  const { refs: { setFloating, setPositionReference }, floatingStyles, update, isPositioned, placement } = useFloating({
    open,
    strategy: "fixed",
    placement: hovers ? "top" : "bottom",
    // Under a finger, past the handles that hang below the selected line; the bigger tools are a fingertip's size
    middleware: [offset(hovers ? 8 : 28), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  useLayoutEffect(() => {
    setPositionReference({
      getBoundingClientRect: () => (held.current = editor.selectionBox() ?? held.current ?? new DOMRect()),
      contextElement: editor.dom,
    });
  }, [setPositionReference, editor]);
  // A new selection moves the reference without a scroll or resize autoUpdate would see
  useLayoutEffect(() => { if (open) update(); });

  const enter = useTempoTransition(spring.pop);
  const hidden = { opacity: 0, scale: reduce ? 1 : scale.popover };
  const below = placement.startsWith("bottom");

  return (
    <FloatingPortal>
      <AnimatePresence>
        {open ? (
          <div key="bar" ref={setFloating} style={floatingStyles} className="z-50">
            {isPositioned ? (
              <motion.div
                role="toolbar"
                aria-label="Format selection"
                initial={hidden}
                animate={{ opacity: 1, scale: 1, transition: enter }}
                exit={{ ...hidden, transition: enter }}
                style={{ transformOrigin: below ? "50% 0%" : "50% 100%" }}
                className="flex items-center gap-0.5 rounded-lg bg-popover p-1 text-dim shadow-md ring-1 ring-foreground/10"
              >
                <TooltipProvider openDelay={400}>
                  {TOOLS.map(({ name, label, keys, icon: Icon }) => (
                    <Label key={name} hovers={hovers} text={label} keys={keys}>
                      <Toggle size={hovers ? "sm" : "lg"} aria-label={label} pressed={editor.isActive(name)} onMouseDown={(e) => e.preventDefault()} onPressedChange={() => editor.run(name)}>
                        <Icon />
                      </Toggle>
                    </Label>
                  ))}
                  <div className="mx-0.5 h-5 w-px bg-line" />
                  <LinkTool editor={editor} side={below ? "bottom" : "top"} onOpenChange={setLinking} label={(text, toggle) => <Label hovers={hovers} text={text}>{toggle}</Label>} />
                </TooltipProvider>
              </motion.div>
            ) : null}
          </div>
        ) : null}
      </AnimatePresence>
    </FloatingPortal>
  );
}
