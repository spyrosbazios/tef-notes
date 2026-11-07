// Lucide icons, the app's set, as SVG text: a widget is drawn by Android from a description, so it takes an icon as an
// SVG string rather than a component. Each from the installed package's own icon data, stroked in a palette colour.
import type { LucideIconData, LucideIconNode } from "lucide-react-native";
import { __iconData as calendarCheck } from "lucide-react-native/icons/calendar-check";
import { __iconData as check } from "lucide-react-native/icons/check";
import { __iconData as moon } from "lucide-react-native/icons/moon";
import { __iconData as notebookPen } from "lucide-react-native/icons/notebook-pen";
import { __iconData as sparkles } from "lucide-react-native/icons/sparkles";

export const ICONS = { calendarCheck, check, moon, notebookPen, sparkles } satisfies Record<string, LucideIconData>;

const element = ([tag, attrs, children]: LucideIconNode): string => {
  const a = Object.entries(attrs).filter(([k]) => k !== "key").map(([k, v]) => ` ${k}="${String(v)}"`).join("");
  return children?.length ? `<${tag}${a}>${children.map(element).join("")}</${tag}>` : `<${tag}${a}/>`;
};

/** `icon` as an SVG document in `color`, at Lucide's stroke (or `stroke`). */
export function svgOf(icon: LucideIconData, color: string, stroke = 2): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" `
    + `stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${icon.node.map(element).join("")}</svg>`;
}
