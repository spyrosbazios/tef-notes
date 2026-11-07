// Home's tile masonry, read by rows: the first tiles across the top, left to right, then the next row. CSS columns fill
// down each column instead, which put the 2nd note under the 1st. Same look as `columns-[15rem] gap-3`: as many 15rem
// columns as fit, stretched to the width, tiles dealt to them in turn.
import { AnimatePresence } from "motion/react";
import { Children, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { columnCount, deal } from "@/lib/masonry";
import { cn } from "@/lib/utils";


export function Masonry({ children, animate = false, className }: { children: ReactNode; animate?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [n, setN] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const measure = () => setN(columnCount(el.clientWidth, rem));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className={cn("flex items-start gap-3", className)}>
      {deal(Children.toArray(children), n).map((col, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col gap-3">
          {animate ? <AnimatePresence initial={false}>{col}</AnimatePresence> : col}
        </div>
      ))}
    </div>
  );
}
