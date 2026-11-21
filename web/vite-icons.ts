// Lucide's icons as CSS masks, for the places the editor draws an icon from a stylesheet (index.css): the editor's DOM is plain
// elements with a `::before`, not React, so there is no <Icon /> to render. Each icon named here becomes `--icon-<name>` on
// `:root`, a `url()` of lucide's own SVG, imported as `virtual:tefnotes-icons.css` (src/main.tsx); index.css uses it as
// `mask: var(--icon-copy) center / contain no-repeat`. Nothing is pasted: a new icon is a name in this list.
// Drawn from lucide's own node data (the `lucide` package, same version as `lucide-react`), not by rendering the React icon:
// a vite config that loads `react-dom/server` fails in the image's Bun (alpine) before the build starts.
import { icons } from "lucide";
import type { Plugin } from "vite";

const EDITOR_ICONS = ["BookOpen", "Copy", "FileText", "ImageOff", "Link", "Shapes", "Sparkles", "Trash"] as const;

const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** Lucide's frame around every icon's shapes (its `defaultAttributes`). */
const FRAME = { xmlns: "http://www.w3.org/2000/svg", width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" };
const attrs = (a: Record<string, string | number | undefined>) =>
  Object.entries(a).filter(([, v]) => v !== undefined).map(([k, v]) => ` ${k}="${String(v).replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"`).join("");

/** One icon as SVG markup. */
export const svgOf = (name: keyof typeof icons) => `<svg${attrs(FRAME)}>${icons[name].map(([tag, a]) => `<${tag}${attrs(a)}/>`).join("")}</svg>`;

/** The `:root` rule with one `--icon-<name>` variable per icon. */
export function iconVars(names: readonly (keyof typeof icons)[]): string {
  const vars = names.map((n) => `  --icon-${kebab(n)}: url("data:image/svg+xml,${encodeURIComponent(svgOf(n))}");`);
  return `:root {\n${vars.join("\n")}\n}\n`;
}

export function editorIcons(): Plugin {
  const ID = "virtual:tefnotes-icons.css", RESOLVED = `\0${ID}`;
  return {
    name: "tefnotes-editor-icons",
    resolveId: (id) => (id === ID ? RESOLVED : undefined),
    load: (id) => (id === RESOLVED ? iconVars(EDITOR_ICONS) : undefined),
  };
}
