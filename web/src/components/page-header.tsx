import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The phone's header, one shape on every tab (Home, Tasks, Assistant, Settings): 44px tall, no rule under it, the page's name
 * large and bold on the left (or a control standing in for it, as Home's lens), ghost icon buttons on the right. */
export function PageHeader({ title, icon, actions, className }: { title: ReactNode; icon?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cn("flex h-11 shrink-0 items-center gap-1 pr-2 pl-4", className)}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {icon}
        {typeof title === "string" ? <h1 className="truncate text-[22px] font-bold tracking-tight">{title}</h1> : title}
      </div>
      {actions}
    </header>
  );
}

/** The header's icon button look: ghost, dim, the 22px glyph Home's Search uses. */
export const HEADER_ICON = "shrink-0 text-dim [&_svg:not([class*='size-'])]:size-[22px]";
