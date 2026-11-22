// Talk in a small panel at a window's corner, where the assistant's button sits (fab.tsx, when the owner's `desktop.fab` asks for
// Talk): the Talk page's own conversation drawn as a phone draws it (page.tsx `Conversation` with `panel`). Opening it starts a
// conversation unless one is on. Close leaves the conversation going (the pill takes over), Expand goes to Talk's page. Its left
// and top edges and the corner between them resize it (the bottom right is where it is anchored), and this browser keeps the size.
// Not on Talk's page, which is all of this, nor on a phone, where Talk is a tab.
import { spring, transition, useTempoTransition } from "@animate-ui/react/utils/motion";
import { AnimatePresence, motion } from "motion/react";
import { Conversation } from "@/components/talk/page";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import { useRef } from "react";
import { clampSide, PANEL_SIZE, setTalkPanel, useTalkPanel, useTalkPanelSize } from "@/lib/talk-panel";
import { cn } from "@/lib/utils";
import { useNav, usePlace } from "@/lib/nav";

const STEP = 24;

type Size = { width: number; height: number };

/** An edge of the panel, or the corner where the two meet: drag, or the arrow keys when focused. The panel grows up and to the left. */
function Edge({ side, size, set }: { side: "width" | "height" | "both"; size: Size; set: (patch: Partial<Size>) => void }) {
  const drag = useRef<{ x: number; y: number } & Size>(undefined);
  const wide = side !== "height", tall = side !== "width";
  const to = (width: number, height: number) => set({ ...(wide ? { width: clampSide("width", width) } : {}), ...(tall ? { height: clampSide("height", height) } : {}) });
  const down = (e: PointerEvent<HTMLDivElement>) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ...size }; };
  const move = (e: PointerEvent<HTMLDivElement>) => { const d = drag.current; if (d) to(d.width + d.x - e.clientX, d.height + d.y - e.clientY); };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const dx = wide ? (e.key === "ArrowLeft" ? STEP : e.key === "ArrowRight" ? -STEP : 0) : 0;
    const dy = tall ? (e.key === "ArrowUp" ? STEP : e.key === "ArrowDown" ? -STEP : 0) : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    to(size.width + dx, size.height + dy);
  };
  const end = () => { drag.current = undefined; };
  const one = side === "both" ? undefined : side;
  return (
    <div role="separator" tabIndex={0} aria-label={side === "both" ? "Resize the panel" : side === "width" ? "Resize the panel's width" : "Resize the panel's height"}
      {...(one ? { "aria-orientation": one === "width" ? "vertical" as const : "horizontal" as const, "aria-valuemin": PANEL_SIZE[one].min, "aria-valuemax": PANEL_SIZE[one].max, "aria-valuenow": size[one] } : {})}
      onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={key}
      className={cn("absolute z-20 touch-none transition-colors hover:bg-brand/30 focus-visible:bg-brand/40 focus-visible:outline-none",
        side === "width" ? "inset-y-0 left-0 w-1.5 cursor-ew-resize" : side === "height" ? "inset-x-0 top-0 h-1.5 cursor-ns-resize" : "top-0 left-0 size-3.5 cursor-nwse-resize rounded-br-md")} />
  );
}

export function TalkPanel() {
  const [size, setSize] = useTalkPanelSize();
  const open = useTalkPanel();
  const { view } = usePlace();
  const { goView } = useNav();
  const pop = useTempoTransition(spring.pop), away = useTempoTransition(transition.dismiss);
  const shown = open && view.kind !== "talk";
  return (
    <AnimatePresence>
      {shown ? (
        <motion.div key="talk-panel" role="dialog" aria-label="Talk"
          initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1, transition: pop }} exit={{ opacity: 0, y: 16, scale: 0.96, transition: away }}
          style={{ transformOrigin: "bottom right", "--panel-w": `${size.width}px`, "--panel-h": `${size.height}px` } as CSSProperties}
          className="fixed right-[max(1.25rem,env(safe-area-inset-right))] bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-40 flex h-[min(var(--panel-h),calc(100dvh-2.5rem))] w-[min(var(--panel-w),calc(100vw-2.5rem))] overflow-hidden rounded-2xl border border-line bg-card shadow-2xl max-md:hidden">
          <Edge side="width" size={size} set={setSize} /><Edge side="height" size={size} set={setSize} /><Edge side="both" size={size} set={setSize} />
          <Conversation panel={{ onClose: () => setTalkPanel(false), onExpand: () => { setTalkPanel(false); goView({ kind: "talk" }); } }} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
