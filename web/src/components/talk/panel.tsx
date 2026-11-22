// Talk in a small panel at a window's corner, where the assistant's button sits (fab.tsx, when the owner's `desktop.fab` asks for
// Talk): the Talk page's own conversation drawn as a phone draws it (page.tsx `Conversation` with `panel`). Opening it starts a
// conversation unless one is on. Close leaves the conversation going (the pill takes over), Expand goes to Talk's page. Its left
// and top edges and the corner between them resize it (the bottom right is where it is anchored); its header moves it, by a drag
// or, on the grip, the arrow keys. This browser keeps the size and the place, and the window always holds the whole panel.
// Not on Talk's page, which is all of this, nor on a phone, where Talk is a tab.
import { spring, transition, useTempoTransition } from "@animate-ui/react/utils/motion";
import { AnimatePresence, motion } from "motion/react";
import { Conversation } from "@/components/talk/page";
import { GripVertical } from "lucide-react";
import type { CSSProperties, HTMLAttributes, KeyboardEvent, PointerEvent, ReactNode, RefObject } from "react";
import { useRef } from "react";
import { clampGap, clampSide, PANEL_SIZE, setTalkPanel, useTalkPanel, useTalkPanelBox, type PanelBox } from "@/lib/talk-panel";
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

/** Moving the panel: its header's pointer handlers (a press on one of its buttons is that button's) and the grip, which the
 *  arrow keys move it by. A move starts from where the panel is drawn, which the window may hold short of what was kept. */
function useMove(panel: RefObject<HTMLDivElement | null>, box: PanelBox, set: (patch: Partial<PanelBox>) => void): { bar: HTMLAttributes<HTMLDivElement>; grip: ReactNode } {
  const drag = useRef<{ x: number; y: number; right: number; bottom: number }>(undefined);
  const placed = (right: number, bottom: number) => {
    const el = panel.current;
    return el ? { right: clampGap(right, innerWidth - el.offsetWidth), bottom: clampGap(bottom, innerHeight - el.offsetHeight) } : { right, bottom };
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as Element).closest("button:not([data-grip])")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ...placed(box.right, box.bottom) };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => { const d = drag.current; if (d) set(placed(d.right + d.x - e.clientX, d.bottom + d.y - e.clientY)); };
  const end = () => { drag.current = undefined; };
  const key = (e: KeyboardEvent<HTMLButtonElement>) => {
    const dx = e.key === "ArrowLeft" ? STEP : e.key === "ArrowRight" ? -STEP : 0;
    const dy = e.key === "ArrowUp" ? STEP : e.key === "ArrowDown" ? -STEP : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    const at = placed(box.right, box.bottom);
    set(placed(at.right + dx, at.bottom + dy));
  };
  return {
    bar: { onPointerDown: down, onPointerMove: move, onPointerUp: end, onPointerCancel: end },
    grip: (
      <button type="button" data-grip aria-label="Move the panel" title="Move" onKeyDown={key}
        className="flex h-8 w-5 shrink-0 cursor-grab items-center justify-center rounded-md text-dim outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-brand active:cursor-grabbing">
        <GripVertical className="size-4" />
      </button>
    ),
  };
}

/** A gap from the window's edge as CSS: what was kept, held inside the window whatever its size is now. */
const gap = (kept: number, inset: string, room: string) => `max(1.25rem, env(safe-area-inset-${inset}), min(${kept}px, calc(${room} - 1.25rem)))`;

export function TalkPanel() {
  const [size, setSize] = useTalkPanelBox();
  const panel = useRef<HTMLDivElement>(null);
  const grip = useMove(panel, size, setSize);
  const open = useTalkPanel();
  const { view } = usePlace();
  const { goView } = useNav();
  const pop = useTempoTransition(spring.pop), away = useTempoTransition(transition.dismiss);
  const shown = open && view.kind !== "talk";
  return (
    <AnimatePresence>
      {shown ? (
        <motion.div key="talk-panel" ref={panel} role="dialog" aria-label="Talk"
          initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1, transition: pop }} exit={{ opacity: 0, y: 16, scale: 0.96, transition: away }}
          style={{ transformOrigin: "bottom right", "--w": `min(${size.width}px, calc(100vw - 2.5rem))`, "--h": `min(${size.height}px, calc(100dvh - 2.5rem))`,
            right: gap(size.right, "right", "100vw - var(--w)"), bottom: gap(size.bottom, "bottom", "100dvh - var(--h)") } as CSSProperties}
          className="fixed z-40 flex h-(--h) w-(--w) overflow-hidden rounded-2xl border border-line bg-card shadow-2xl max-md:hidden">
          <Edge side="width" size={size} set={setSize} /><Edge side="height" size={size} set={setSize} /><Edge side="both" size={size} set={setSize} />
          <Conversation panel={{ ...grip, onClose: () => setTalkPanel(false), onExpand: () => { setTalkPanel(false); goView({ kind: "talk" }); } }} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
