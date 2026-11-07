// A hairline in the theme's line colour, across or (`vertical`) up.
import * as Primitive from "@rn-primitives/separator";
import { cn } from "./cn";

export function Separator({ vertical, inset, className }: { vertical?: boolean; inset?: boolean; className?: string }) {
  return (
    <Primitive.Root orientation={vertical ? "vertical" : "horizontal"} decorative
      className={cn("shrink-0 bg-line", vertical ? "h-full w-px" : "h-px w-full", inset && "ml-14", className)} />
  );
}
