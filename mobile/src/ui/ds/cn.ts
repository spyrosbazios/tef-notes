// Class names joined, the later winning a conflict (two colours, two sizes): a caller's className overrides a
// component's own instead of meeting it in CSS order.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...v: ClassValue[]) => twMerge(clsx(v));
