// Home's tile masonry, read by rows: the first tiles across the top, left to right, then the next row. CSS columns fill
// down each column instead, which put the 2nd note under the 1st. Same look as `columns-[15rem] gap-3`: as many 15rem
// columns as fit, stretched to the width, tiles dealt to them in turn. With `animate` the columns are one layout group, so a tile
// that changes column (a resize, a new sort) glides there (its `layoutId`, note-list.tsx) instead of leaving one and entering the
// other; on a phone, where many pictures gliding at once would be a jank risk, each column animates its own.
import { AnimatePresence, LayoutGroup } from "motion/react";
import { Children, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useNarrow } from "@/hooks/media";
import { columnCount, deal } from "@/lib/masonry";
import { cn } from "@/lib/utils";


export function Masonry({ children, animate = false, className }: { children: ReactNode; animate?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [n, setN] = useState(1);
  const narrow = useNarrow(), glide = animate && !narrow;
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
  const columns = deal(Children.toArray(children), n).map((col, i) => (
    <div key={i} className="flex min-w-0 flex-1 flex-col gap-3">
      {animate ? <AnimatePresence initial={false}>{col}</AnimatePresence> : col}
    </div>
  ));
  return <div ref={ref} className={cn("flex items-start gap-3", className)}>{glide ? <LayoutGroup>{columns}</LayoutGroup> : columns}</div>;
}
