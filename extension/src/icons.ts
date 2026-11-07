// lucide, the project's icon set, as DOM nodes: these pages have no framework to carry lucide-react. The brand mark is
// the launcher's own outline (packages/core/src/brand.ts), the one the phone, the web app and the site draw.
import { Check, CircleAlert, ClipboardPlus, createElement, FilePlus, Globe, ListPlus, ListTodo, Loader, Plus, X } from "lucide";
import { MARK_PATH, MARK_VIEWBOX } from "@/core/brand";

export const icon = { busy: Loader, done: Check, fail: CircleAlert, append: ListPlus, task: ListTodo, newtask: ClipboardPlus, create: FilePlus, add: Plus, remove: X, page: Globe };
export const draw = (node: (typeof icon)[keyof typeof icon], size = 18) => createElement(node, { width: size, height: size });

const NS = "http://www.w3.org/2000/svg";
/** The brand mark at `size`, filled with the current colour (ui.css gives the heading's svg the brand colour). */
export function mark(size = 20) {
  const svg = document.createElementNS(NS, "svg"), path = document.createElementNS(NS, "path");
  svg.setAttribute("viewBox", MARK_VIEWBOX);
  svg.setAttribute("width", `${size}`);
  svg.setAttribute("height", `${size}`);
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  path.setAttribute("d", MARK_PATH);
  path.setAttribute("fill-rule", "evenodd");
  svg.append(path);
  return svg;
}
