// Lucide's icons as CSS masks, for the places the editor draws an icon from a stylesheet (index.css): the editor's DOM is plain
// elements with a `::before`, not React, so there is no <Icon /> to render. Each icon named here becomes `--icon-<name>` on
// `:root`, a `url()` of lucide's own SVG, imported as `virtual:tefnotes-icons.css` (src/main.tsx); index.css uses it as
// `mask: var(--icon-copy) center / contain no-repeat`. Nothing is pasted: a new icon is a name in this list.
import { icons } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Plugin } from "vite";

const EDITOR_ICONS = ["BookOpen", "Copy", "FileText", "ImageOff", "Link", "Shapes", "Sparkles", "Trash"] as const;

const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** The `:root` rule with one `--icon-<name>` variable per icon. */
export function iconVars(names: readonly (keyof typeof icons)[]): string {
  const vars = names.map((n) => `  --icon-${kebab(n)}: url("data:image/svg+xml,${encodeURIComponent(renderToStaticMarkup(createElement(icons[n])))}");`);
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
