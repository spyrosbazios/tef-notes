// A row of a settings box.
import { type ReactNode } from "react";

/** A row of a settings box: a name, a line under it, and a control at the end. */
export function Line({ title, detail, trailing }: { title: string; detail?: string; trailing?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        {detail ? <p className="text-[13px] leading-snug text-dim">{detail}</p> : null}
      </div>
      {trailing}
    </div>
  );
}
