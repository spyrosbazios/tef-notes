// The assistant's dock, mounted once in the shell. From `xl` up it sits beside the page, which shrinks to make room, and
// its left edge drags to resize; narrower, it covers the page (a right-hand sheet from `md`, the whole screen below): the
// notes and tasks panes keep their widths, and are not squeezed. Closed, it is gone from the layout, but the chat is not:
// that is the provider's (provider.tsx). Under a finger it is opened by the app bar's Assistant button (or the corner button
// while closed) and closed by the panel's X: there is no edge to drag and no scrim, the page is behind it, not beside it.
// Below `md` it is the Ask tab: the whole page above the tab bar (`--dock-bottom`, set by the shell), closed by any other tab.
// How it comes and goes follows that: the sheet slides in from the right and speeds off it (Animate UI's sheet), the tab only fades
// quickly (a tab switch is not a place to travel to), and the docked one does not move at all, as the page beside it would have to
// animate its width with it.
import { transition, useShouldReduceMotion, useTempoTransition } from "@animate-ui/react/utils/motion";
import { AnimatePresence, motion, useIsPresent, type MotionProps } from "motion/react";
import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { Panel } from "@/components/assistant/panel";
import { clampWidth, DOCK_WIDTH, setDock, useDock } from "@/hooks/dock";
import { useMedia, useNarrow } from "@/hooks/media";

const STEP = 24;

/** The edge between the page and the dock: drag, or arrow keys when focused. */
function Edge({ width }: { width: number }) {
  const drag = useRef<{ x: number; width: number }>(undefined);
  const down = (e: PointerEvent<HTMLDivElement>) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, width }; };
  const move = (e: PointerEvent<HTMLDivElement>) => { if (drag.current) setDock({ width: clampWidth(drag.current.width + drag.current.x - e.clientX) }); };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); setDock({ width: clampWidth(width + STEP) }); }
    else if (e.key === "ArrowRight") { e.preventDefault(); setDock({ width: clampWidth(width - STEP) }); }
  };
  return (
    <div role="separator" aria-orientation="vertical" aria-label="Resize the assistant" aria-valuemin={DOCK_WIDTH.min} aria-valuemax={DOCK_WIDTH.max} aria-valuenow={width} tabIndex={0}
      onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = undefined; }} onKeyDown={key}
      className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none transition-colors hover:bg-brand/30 focus-visible:bg-brand/40 focus-visible:outline-none max-xl:hidden" />
  );
}

/** The dock's box. Once it starts leaving it is inert: the page behind takes the taps at once, rather than the fading sheet over it. */
function Aside({ width, moves }: { width: number; moves: MotionProps }) {
  const ref = useRef<HTMLElement>(null), present = useIsPresent();
  useLayoutEffect(() => { if (ref.current) ref.current.inert = !present; }, [present]);
  return (
    <motion.aside ref={ref} data-assistant aria-label="Assistant" style={{ "--dock-w": `${width}px` } as CSSProperties} {...moves}
      // The rail (240px) and a list with its pane (660px) keep their room: the dock takes what is left, up to its own width
      className="fixed inset-0 z-40 bg-bg max-md:bottom-(--dock-bottom) md:left-auto md:w-(--dock-w) md:max-w-full md:border-l md:border-line md:shadow-xl xl:relative xl:inset-auto xl:z-auto xl:max-w-[calc(100vw-900px)] xl:min-w-80 xl:shrink-0 xl:shadow-none">
      <Edge width={width} />
      <Panel />
    </motion.aside>
  );
}

export function Dock() {
  const [{ open, width }] = useDock();
  const docked = useMedia("(min-width: 1280px)"), tab = useNarrow(), reduce = useShouldReduceMotion();
  const enter = useTempoTransition(transition.sheet), leave = useTempoTransition(transition.dismiss), quick = useTempoTransition(transition.swap);
  // The same transform function at both ends, which Motion can interpolate; under reduced motion the sheet fades in place
  const shown = "translateX(0%)", away = { opacity: 0, transform: reduce ? shown : "translateX(100%)" };
  const moves = docked ? {} : tab
    ? { initial: { opacity: 0 }, animate: { opacity: 1, transition: quick }, exit: { opacity: 0, transition: quick } }
    : { initial: away, animate: { opacity: 1, transform: shown, transition: enter }, exit: { ...away, transition: leave } };
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <Aside key="dock" width={width} moves={moves} />
      ) : null}
    </AnimatePresence>
  );
}
