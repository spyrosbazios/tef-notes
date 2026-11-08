// The assistant's dock, mounted once in the shell. From `xl` up it sits beside the page, which shrinks to make room, and
// its left edge drags to resize; narrower, it covers the page (a right-hand sheet from `md`, the whole screen below): the
// notes and tasks panes keep their widths, and are not squeezed. Closed, it is gone from the layout, but the chat is not:
// that is the provider's (provider.tsx). Under a finger it is opened by the app bar's Assistant button (or the corner button
// while closed) and closed by the panel's X: there is no edge to drag and no scrim, the page is behind it, not beside it.
// Below `md` it is the Ask tab: the whole page above the tab bar (`--dock-bottom`, set by the shell), closed by any other tab.
import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { Panel } from "@/components/assistant/panel";
import { clampWidth, DOCK_WIDTH, setDock, useDock } from "@/hooks/dock";

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

export function Dock() {
  const [{ open, width }] = useDock();
  if (!open) return null;
  return (
    <aside data-assistant aria-label="Assistant" style={{ "--dock-w": `${width}px` } as CSSProperties}
      // The rail (240px) and a list with its pane (660px) keep their room: the dock takes what is left, up to its own width
      className="fixed inset-0 z-40 bg-bg max-md:bottom-(--dock-bottom) md:left-auto md:w-(--dock-w) md:max-w-full md:border-l md:border-line md:shadow-xl xl:relative xl:inset-auto xl:z-auto xl:max-w-[calc(100vw-900px)] xl:min-w-80 xl:shrink-0 xl:shadow-none">
      <Edge width={width} />
      <Panel />
    </aside>
  );
}
