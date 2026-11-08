// The round box that ticks a task or a checklist item, on the animated Checkbox: the fill answers the press at once, the
// check draws itself a moment after. Callers keep the write to themselves (a tick waits its 1.5 s in hooks/linger.ts), so the
// box is controlled by `checked` and takes `onClick`, never `onCheckedChange`. The box's own `::after` is the touch target: the box itself on a mouse, 40px square under a finger (what `hit` does for
// a bare button; the Checkbox already positions its `::after`, so `hit`'s own would fight it).
import type { ComponentProps } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

const SIZE = {
  lg: "size-6 any-pointer-coarse:after:-inset-2 [&_[data-slot=checkbox-indicator]>svg]:size-4",
  md: "size-[18px] any-pointer-coarse:after:-inset-[11px] [&_[data-slot=checkbox-indicator]>svg]:size-3",
  sm: "size-4 any-pointer-coarse:after:-inset-3 [&_[data-slot=checkbox-indicator]>svg]:size-2.5",
};

export function TickBox({ size = "md", className, ...props }: Omit<ComponentProps<typeof Checkbox>, "onCheckedChange"> & { size?: keyof typeof SIZE }) {
  return (
    <Checkbox
      className={cn(
        "rounded-full border-[1.5px] border-faint bg-transparent after:inset-0 enabled:hover:border-brand disabled:cursor-default disabled:opacity-100 data-checked:border-brand data-checked:bg-brand data-checked:text-bg dark:bg-transparent dark:data-checked:bg-brand [&_svg]:stroke-[3.5]",
        SIZE[size], className,
      )}
      {...props} />
  );
}
