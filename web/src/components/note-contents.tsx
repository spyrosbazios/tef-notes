// A note's contents: a rail of small ticks at the left of its text, one per heading, as long as the heading is high (the
// editor's outline, editor/outline.ts). The tick of the section being read is in the brand colour, and that mark glides from tick
// to tick with the scroll. Under a mouse a tick shows a card of its heading and the first words under it (Animate UI's own Tooltip:
// one card that glides from tick to tick) and a click scrolls there. On a phone the left edge is Android's back gesture, so the
// ticks take no touches: they fade in while the note scrolls, to say where you are, and the header's Contents button opens the
// headings as a sheet. What it draws is hooks/contents.ts's.
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@animate-ui/react/primitives/tooltip";
import { spring, transition, useShouldReduceMotion, useTempoTransition } from "@animate-ui/react/utils/motion";
import { TableOfContents } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { SheetBody } from "@/components/pick";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";
import type { OutlineItem } from "@/editor";
import type { Contents } from "@/hooks/contents";
import { useHovers } from "@/hooks/hover";
import { useNarrow } from "@/hooks/media";
import { cn } from "@/lib/utils";

/** A tick's row, and its line's length by the heading's level (the mark is as long as the longest, scaled to its tick's). */
const ROW = 12, LONG = 22;
const lengthOf = (level: number) => (level <= 1 ? LONG : level === 2 ? 15 : 9);

/** The rail, laid over the note's scroller (its parent is `relative`): it stays put while the note scrolls under it. From a pane
 *  wide enough it stands in the margin beside the text, below that in the text's own padding. */
export function ContentsRail({ contents }: { contents: Contents }) {
  const { items, current, scrolling, jump } = contents;
  const narrow = useNarrow(), hovers = useHovers(), reduce = useShouldReduceMotion();
  const glide = useTempoTransition(spring.selection), pop = useTempoTransition(spring.pop), reflow = useTempoTransition(spring.reflow);
  const leave = useTempoTransition(transition.popOut), fade = useTempoTransition(transition.fade);
  const gone = { opacity: 0, scaleX: reduce ? 1 : 0 };

  const tick = (item: OutlineItem, i: number) => (
    <motion.button type="button" aria-label={item.title} aria-current={i === current ? "location" : undefined}
      initial={gone} animate={{ opacity: 1, scaleX: 1, transition: pop }} exit={{ ...gone, transition: leave }}
      // The note keeps its caret and its keyboard
      onMouseDown={(e) => e.preventDefault()} onClick={() => jump(i)}
      className="group relative block w-8 origin-left cursor-pointer outline-none" style={{ height: ROW }}>
      <span className="absolute top-[5px] left-0 h-0.5 rounded-full bg-faint transition-colors group-hover:bg-fg group-focus-visible:bg-fg" style={{ width: lengthOf(item.level) }} />
    </motion.button>
  );

  return (
    <div className="@container pointer-events-none absolute inset-0 z-10">
      <div className="mx-auto flex h-full max-w-3xl items-center">
        <AnimatePresence>
          {items.length ? (
            <motion.nav key="rail" aria-label="Contents" inert={narrow} layout="position" layoutDependency={items.length}
              initial={{ opacity: 0 }} animate={{ opacity: narrow && !scrolling ? 0 : 1 }} exit={{ opacity: 0 }} transition={{ opacity: fade, layout: reflow }}
              className="relative ml-1 flex origin-left flex-col max-md:scale-[.6] md:pointer-events-auto md:ml-2 @5xl:-ml-10">
              <TooltipProvider openDelay={120}>
                <AnimatePresence initial={false}>
                  {items.map((item, i) => (hovers ? (
                    <Tooltip key={i} side="right" align="start" sideOffset={10} alignOffset={-14}>
                      <TooltipTrigger asChild>{tick(item, i)}</TooltipTrigger>
                      <TooltipContent className="z-50 w-60 rounded-lg bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10">
                        <p className="truncate text-[13px] font-semibold">{item.title}</p>
                        {item.lead ? <p className="mt-1 line-clamp-2 text-xs leading-snug text-dim">{item.lead}</p> : null}
                      </TooltipContent>
                    </Tooltip>
                  ) : <ContentsTick key={i}>{tick(item, i)}</ContentsTick>))}
                </AnimatePresence>
              </TooltipProvider>
              <motion.span aria-hidden initial={false} animate={{ y: current * ROW, scaleX: lengthOf(items[current].level) / LONG }} transition={glide}
                className="pointer-events-none absolute top-[5px] left-0 h-0.5 origin-left rounded-full bg-brand" style={{ width: LONG }} />
            </motion.nav>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** A tick with no card (under a finger): keyed like the ones that have one, so a tick keeps its place when the pointer changes. */
const ContentsTick = ({ children }: { children: React.ReactNode }) => children;

/** The phone's way in: a button for the note's bar, opening the headings as a sheet. Nothing where the rail's ticks can be pressed. */
export function ContentsButton({ contents }: { contents: Contents }) {
  const { items, current, jump } = contents;
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  if (!narrow || !items.length) return null;
  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild><Button variant="ghost" size="icon" aria-label="Contents"><TableOfContents className="text-dim" /></Button></DrawerTrigger>
      <DrawerContent>
        <SheetBody title="Contents" className="px-2">
          <nav aria-label="Contents">
            {items.map((item, i) => (
              <button key={i} type="button" aria-current={i === current ? "location" : undefined} onClick={() => { setOpen(false); jump(i); }}
                className={cn("block w-full truncate rounded-lg py-2.5 pr-3 text-left text-sm active:bg-muted",
                  item.level <= 1 ? "pl-3" : item.level === 2 ? "pl-7" : "pl-11",
                  i === current ? "font-semibold text-brand" : item.level > 2 ? "text-dim" : "")}>
                {item.title}
              </button>
            ))}
          </nav>
        </SheetBody>
      </DrawerContent>
    </Drawer>
  );
}
