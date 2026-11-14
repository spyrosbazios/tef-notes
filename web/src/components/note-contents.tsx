// A note's contents: a rail of small ticks at the left of its text, one per heading, as long as the heading is high (the
// editor's outline, editor/outline.ts). The tick of the section being read is in the brand colour, and that mark glides from tick
// to tick with the scroll. Under a mouse a tick shows a card of its heading and the first words under it (Animate UI's own Tooltip:
// one card that glides from tick to tick) and a click scrolls there. On a phone the ticks are small and fade in while the note
// scrolls, to say where you are; a finger held at the left edge opens them to a fingertip's step around it, and dragged along the
// edge it goes through the headings, the note following and the same card beside the finger (hooks/contents.ts `useScrub`).
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@animate-ui/react/primitives/tooltip";
import { blur, scale, spring, transition, useShouldReduceMotion, useTempoTransition } from "@animate-ui/react/utils/motion";
import { AnimatePresence, motion } from "motion/react";
import type { OutlineItem } from "@/editor";
import { useScrub, type Contents, type Scrub } from "@/hooks/contents";
import { useHovers } from "@/hooks/hover";
import { useNarrow } from "@/hooks/media";

/** A tick's row, and its line's length by the heading's level (the mark is as long as the longest, scaled to its tick's). */
const ROW = 12, LONG = 22;
const lengthOf = (level: number) => (level <= 1 ? LONG : level === 2 ? 15 : 9);
/** The phone's rail at rest: its row, and how much of their size its ticks are. */
const SMALL_ROW = 7, SMALL = 0.6;
/** Under a finger: the tick it is on and the ones beside it grow, so the place reads past the fingertip. */
const ON = 1.35, BESIDE = 1.15;

const CARD = "w-60 rounded-lg bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10";

/** A heading and the first words under it. */
function Card({ item }: { item: OutlineItem }) {
  return (
    <>
      <p className="truncate text-[13px] font-semibold">{item.title}</p>
      {item.lead ? <p className="mt-1 line-clamp-2 text-xs leading-snug text-dim">{item.lead}</p> : null}
    </>
  );
}

/** The rail, laid over the note's scroller (its parent is `relative`): it stays put while the note scrolls under it. */
export function ContentsRail({ contents }: { contents: Contents }) {
  const narrow = useNarrow();
  const scrub = useScrub(contents, narrow);
  return narrow ? <PhoneRail contents={contents} scrub={scrub} /> : <DeskRail contents={contents} />;
}

/** From a pane wide enough it stands in the margin beside the text, below that in the text's own padding. */
function DeskRail({ contents }: { contents: Contents }) {
  const { items, current, jump } = contents;
  const hovers = useHovers(), reduce = useShouldReduceMotion();
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
            <motion.nav key="rail" aria-label="Contents" layout="position" layoutDependency={items.length}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ opacity: fade, layout: reflow }}
              className="pointer-events-auto relative ml-2 flex flex-col @5xl:-ml-10">
              <TooltipProvider openDelay={120}>
                <AnimatePresence initial={false}>
                  {items.map((item, i) => (hovers ? (
                    <Tooltip key={i} side="right" align="start" sideOffset={10} alignOffset={-14}>
                      <TooltipTrigger asChild>{tick(item, i)}</TooltipTrigger>
                      <TooltipContent className={`z-50 ${CARD}`}><Card item={item} /></TooltipContent>
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

/** The phone's rail. It takes no touches itself (the scroller hears the hold, so a scroll begun at the edge is still a scroll):
 *  it is drawn from `scrub`. Every tick is placed by a transform from the rail's centre line, so opening it is one motion. */
function PhoneRail({ contents, scrub }: { contents: Contents; scrub: Scrub | null }) {
  const { items, current, scrolling } = contents;
  const reduce = useShouldReduceMotion();
  const bloom = useTempoTransition(spring.pop), follow = useTempoTransition(spring.highlight), glide = useTempoTransition(spring.selection);
  const fade = useTempoTransition(transition.fade), swap = useTempoTransition(transition.swap);
  if (!items.length) return null;

  const row = scrub?.row ?? SMALL_ROW, at = Math.min(scrub?.index ?? current, items.length - 1);
  // From the scroller's centre line: the rail's top, each tick's line, and the card's (kept clear of the top and bottom edges)
  const top = scrub ? scrub.top - scrub.height / 2 : -(items.length * SMALL_ROW) / 2;
  const line = (i: number) => top + (i + 0.5) * row - 1;
  const size = (i: number) => (!scrub ? SMALL : i === at ? ON : Math.abs(i - at) === 1 ? BESIDE : 1);
  const reach = scrub ? scrub.height / 2 - 52 : 0;
  const hidden = { opacity: 0, scale: reduce ? 1 : scale.popover };

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <motion.div initial={false} animate={{ opacity: scrub || scrolling ? 1 : 0 }} transition={fade} className="absolute top-1/2 left-1">
        {items.map((item, i) => (
          <motion.span key={i} initial={false} animate={{ y: line(i), scale: size(i) }} transition={scrub ? follow : bloom}
            className="absolute top-0 left-0 h-0.5 origin-left rounded-full bg-faint" style={{ width: lengthOf(item.level) }} />
        ))}
        <motion.span initial={false} animate={{ y: line(at), scaleX: (lengthOf(items[at].level) / LONG) * size(at), scaleY: size(at) }} transition={scrub ? follow : glide}
          className="absolute top-0 left-0 h-0.5 origin-left rounded-full bg-brand" style={{ width: LONG }} />
      </motion.div>
      <AnimatePresence>
        {scrub ? (
          <motion.div key="card" initial={false} animate={{ y: Math.max(-reach, Math.min(reach, line(at))) }} transition={follow} className="absolute top-1/2 left-12 h-0">
            <motion.div initial={hidden} animate={{ opacity: 1, scale: 1, transition: bloom }} exit={{ ...hidden, transition: bloom }}
              className={`relative max-w-[calc(100vw-4rem)] -translate-y-1/2 ${CARD}`} style={{ transformOrigin: "0% 50%" }}>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div key={at} initial={{ opacity: 0, filter: blur.icon }} animate={{ opacity: 1, filter: "blur(0px)", transition: swap }} exit={{ opacity: 0, filter: blur.icon, transition: swap }}>
                  <Card item={items[at]} />
                </motion.div>
              </AnimatePresence>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
