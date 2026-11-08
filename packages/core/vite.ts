// What the Vite builds (web/, site/, extension/) share, beside the runtime core in src/: the palette as CSS variables and
// the tab's identity. Build-time only (Node imports), so it sits outside src/, which every runtime imports. The plugin
// shape is declared here, structurally, rather than imported from vite: the core carries no dependency, and each client
// checks the object against its own vite's `Plugin`.
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { PDF } from "./src/photos";
import { SHARE_PATH } from "./src/share-target";
import { C, DEFAULT_THEME, THEMES, themeVars, type Theme } from "./src/theme";

type Tag = { tag: string; attrs: Record<string, string>; injectTo: "head" };
type Plugin = {
  name: string;
  resolveId?: (id: string) => string | undefined;
  load?: (id: string) => string | undefined;
  configureServer?: (s: { middlewares: { use(fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void): unknown } }) => void;
  configResolved?: (c: { base: string }) => void;
  generateBundle?: (this: { emitFile(f: { type: "asset"; fileName: string; source: string | Uint8Array }): string }) => void;
  transformIndexHtml?: () => Tag[];
};

export const CORE_SRC = fileURLToPath(new URL("./src/", import.meta.url));
const ICON = fileURLToPath(new URL("../../mobile/assets/images/icon.png", import.meta.url));

/** The default theme's palette (src/theme.ts) as `--tf-*` variables on `:root`, imported as `virtual:tefnotes-theme.css`.
 *  `extra` adds a client's own washes of it (the site's glow and glass), made from the theme's colours. The web app
 *  re-sets the variables to the user's theme at runtime (web/src/page-theme.ts); the others keep the default. */
export function theme(extra?: (t: Theme) => Record<string, string>): Plugin {
  const ID = "virtual:tefnotes-theme.css", RESOLVED = `\0${ID}`;
  const t = THEMES[DEFAULT_THEME];
  const vars = Object.entries({ ...themeVars(t), ...extra?.(t) }).map(([k, v]) => `  --tf-${k}: ${v};`);
  return {
    name: "tefnotes-theme",
    resolveId: (id) => (id === ID ? RESOLVED : undefined),
    load: (id) => (id === RESOLVED ? `:root {\n${vars.join("\n")}\n}\n` : undefined),
  };
}

/** The tab's identity from the phone's own: its app icon as the favicon (and, with `manifest`, the web manifest's icon,
 *  name and colours). Emitted at build, served from memory in dev; the page names no file. The tags and the manifest
 *  carry the build's `base` (Vite does not prefix a tag a plugin injects). */
export function identity({ manifest = false } = {}): Plugin {
  let base = "/";
  const icon = () => readFileSync(ICON);
  const webmanifest = () => JSON.stringify({
    name: "TEF Notes", short_name: "TEF Notes", start_url: base, scope: base, display: "standalone", theme_color: C.bg, background_color: C.bg,
    icons: [{ src: `${base}icon.png`, sizes: "1024x1024", type: "image/png" }],
    // Android's Share sheet lists the installed app: a link, text, photos or a PDF POSTed to the service worker (web/sw/sw.ts),
    // which hands them to the Share page (core/share-stash.ts). One `files` entry takes both kinds.
    share_target: {
      action: `${base}${SHARE_PATH}`, method: "POST", enctype: "multipart/form-data",
      params: { title: "title", text: "text", url: "url", files: [{ name: "files", accept: ["image/*", PDF] }] },
    },
  });
  const tags = (): Tag[] => [
    { tag: "link", attrs: { rel: "icon", type: "image/png", href: `${base}icon.png` }, injectTo: "head" },
    ...(manifest ? [{ tag: "link", attrs: { rel: "manifest", href: `${base}manifest.webmanifest` }, injectTo: "head" as const }] : []),
    { tag: "meta", attrs: { name: "theme-color", content: C.bg }, injectTo: "head" },
  ];
  return {
    name: "tefnotes-identity",
    configResolved: (c) => { base = c.base; },
    configureServer: (s) => {
      s.middlewares.use((req, res, next) => {
        if (req.url === "/icon.png") { res.setHeader("content-type", "image/png"); res.end(icon()); }
        else if (manifest && req.url === "/manifest.webmanifest") { res.setHeader("content-type", "application/manifest+json"); res.end(webmanifest()); }
        else next();
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "icon.png", source: icon() });
      if (manifest) this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: webmanifest() });
    },
    transformIndexHtml: tags,
  };
}
