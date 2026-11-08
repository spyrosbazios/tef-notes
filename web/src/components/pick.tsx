// Where a picker opens: a popover beside its trigger in a window, a bottom sheet (the shadcn drawer, Animate UI's) at phone width, as
// the phone's pickers are. One component for the When, repeat, reminder, tags and note pickers, so a field has one picker whatever
// the width. A sheet opened from inside another (the task's own) is a nested one, so the two stack.
import { createContext, useContext, useState, type ReactNode } from "react";
import { NestedRoot } from "@animate-ui/react/primitives/radix-ui/drawer";
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNarrow } from "@/hooks/media";
import { cn } from "@/lib/utils";

const Inside = createContext(false);

/** Marks what is drawn inside a sheet: pickers opened from it nest. */
export const InSheet = Inside.Provider;

/** The sheet's frame: a grab handle, a title, and a body that scrolls. */
export function SheetBody({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <>
      <DrawerTitle className="px-4 pt-1 pb-2 text-center text-[15px] font-semibold">{title}</DrawerTitle>
      <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]", className)}>
        <InSheet value>{children}</InSheet>
      </div>
    </>
  );
}

/** `trigger` opens `children` as a popover (`align`, `width` its box) or, below `md`, a sheet titled `title`. Controlled when `open` is
 *  given; `onOpenChange` hears every change either way. */
export function Pick({ trigger, title, open, onOpenChange, align = "start", width = "w-64", children }: {
  trigger: ReactNode; title: string; open?: boolean; onOpenChange?: (o: boolean) => void; align?: "start" | "center" | "end"; width?: string; children: ReactNode;
}) {
  const narrow = useNarrow(), nested = useContext(Inside);
  const [own, setOwn] = useState(false);
  const shown = open ?? own;
  const set = (o: boolean) => { setOwn(o); onOpenChange?.(o); };
  if (!narrow) {
    return (
      <Popover open={shown} onOpenChange={set}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align={align} className={width} onClick={(e) => e.stopPropagation()}>{children}</PopoverContent>
      </Popover>
    );
  }
  const Root = nested ? NestedRoot : Drawer;
  return (
    <Root open={shown} onOpenChange={set}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent><SheetBody title={title}>{children}</SheetBody></DrawerContent>
    </Root>
  );
}
