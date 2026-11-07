// The extension's build: the popup and options pages and the service worker into dist/, with the manifest, the icon PNGs
// and the palette's CSS variables generated here (packages/core/vite.ts; nothing under src/ names a colour or ships a binary).
import { Resvg } from "@resvg/resvg-js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { markSvg } from "../packages/core/src/brand";
import { C } from "../packages/core/src/theme";
import { CORE_SRC, theme } from "../packages/core/vite";

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));
/** The repo's one version, from scripts/version.sh (TEF_NOTES_VERSION, else the latest git tag, else 0.0.0). Chrome takes
 *  only dot-separated integers as `version`, so a pre-release suffix (0.2.0-rc.1) goes to `version_name`. */
const VERSION = execFileSync("sh", [at("../scripts/version.sh")], { encoding: "utf8" }).trim();
const [CHROME_VERSION] = VERSION.split(/[-+]/);
const SIZES = [16, 32, 48, 128];
/** The server's public origin, set by the server image's build (server/docker-compose.yml): Chrome polls its
 *  update.xml for a newer self-hosted CRX (scripts/crx.ts). Unset for a Load-unpacked build, which never updates. */
const SERVER = process.env.TEF_NOTES_URL;

/** The manifest and the toolbar icons. The icon is the brand mark (the launcher's own outline, packages/core/src/brand.ts,
 *  in the brand colour), rasterised at each size Chrome asks for. */
function manifest(): Plugin {
  const svg = markSvg(C.brand);
  const icons = Object.fromEntries(SIZES.map((s) => [s, `icons/${s}.png`]));
  return {
    name: "tefnotes-manifest",
    generateBundle() {
      for (const s of SIZES) {
        const png = new Resvg(svg, { fitTo: { mode: "width", value: s } }).render().asPng();
        this.emitFile({ type: "asset", fileName: `icons/${s}.png`, source: png });
      }
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: JSON.stringify({
          manifest_version: 3,
          name: "TEF Notes Clipper",
          version: CHROME_VERSION,
          ...(VERSION !== CHROME_VERSION && { version_name: VERSION }),
          ...(SERVER && { update_url: `${SERVER}/extension/update.xml` }),
          description: "Save the current page, or a picture on it, to TEF Notes, in the note you pick from the server's suggestions.",
          icons,
          action: { default_title: "Save to TEF Notes", default_popup: "popup.html", default_icon: icons },
          options_ui: { page: "options.html", open_in_tab: true },
          background: { service_worker: "background.js", type: "module" },
          permissions: ["activeTab", "scripting", "storage", "contextMenus"],
          // Only the configured server's origin is ever requested, from the options page at runtime.
          optional_host_permissions: ["https://*/*", "http://*/*"],
        }, null, 2),
      });
    },
  };
}

export default defineConfig({
  root: at("./src"),
  resolve: { alias: [{ find: /^@\/core\//, replacement: CORE_SRC }] },
  base: "./",
  plugins: [theme(), manifest()],
  build: {
    outDir: at("./dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: { popup: at("./src/popup.html"), options: at("./src/options.html"), background: at("./src/background.ts") },
      output: {
        // The manifest names the worker, so it alone keeps a stable file name.
        entryFileNames: (c) => (c.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
