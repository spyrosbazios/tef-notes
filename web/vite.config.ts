import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { boot } from "./vite-boot";
import { alias, at, identity, theme } from "./vite-shared";

export default defineConfig({
  plugins: [
    // The file routes (src/routes/) into src/routeTree.gen.ts, each route's component split into its own chunk; before react()
    tanstackRouter({ target: "react", autoCodeSplitting: true, quoteStyle: "double" }),
    react(), tailwindcss(), theme(), identity({ manifest: true }), boot(),
    // The service worker (sw/sw.ts): the built app precached, so a return visit opens what is installed and a new deploy is
    // announced by a toast (src/components/update-toast.tsx) rather than taken mid-session; and the share target's POST to
    // /share, which Android's Share sheet sends. Nothing from the server is ever cached: /api, /agent, the admin UI and the
    // extension's files bypass the fallback. The manifest is identity()'s, and never cached: the server serves it in the
    // owner's theme (server/pb_hooks/manifest.pb.js), and Chrome must see that copy when it checks for an update.
    VitePWA({
      strategies: "injectManifest",
      srcDir: "sw",
      filename: "sw.ts",
      registerType: "prompt",
      manifest: false,
      includeAssets: ["icon.png"],
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,woff2,ttf,png,svg}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
  ],
  resolve: { alias },
  // This build's id: the persisted query cache is only honoured by the build that wrote it (src/lib/persist.ts).
  // __APP_VERSION__: the repo's one version (scripts/version.sh), shown in Settings → Maintenance with the build's time.
  define: {
    __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
    __APP_VERSION__: JSON.stringify(execFileSync("sh", [at("../scripts/version.sh")], { encoding: "utf8" }).trim()),
  },
  // The fonts (../assets) and the core (../packages/core) come from outside this root. TEF_NOTES_SERVER: the server `bun dev` talks to.
  server: { fs: { allow: [at("..")] }, proxy: process.env.TEF_NOTES_SERVER ? Object.fromEntries(["/api", "/agent"].map((p) => [p, { target: process.env.TEF_NOTES_SERVER, changeOrigin: true }])) : undefined },
  build: { outDir: "dist", emptyOutDir: true },
});
