import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { alias, at, identity, theme } from "./vite-shared";

export default defineConfig({
  plugins: [
    react(), tailwindcss(), theme(), identity({ manifest: true }),
    // The service worker: the built app precached, so a return visit opens what is installed and a new deploy is
    // announced by a toast (src/components/update-toast.tsx) rather than taken mid-session. The manifest is identity()'s.
    // Nothing from the server is ever cached: /api, /agent, the admin UI and the extension's files bypass the fallback.
    VitePWA({
      registerType: "prompt",
      manifest: false,
      includeAssets: ["icon.png", "manifest.webmanifest"],
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,ttf,png,svg}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//, /^\/agent\//, /^\/_\//, /^\/extension\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: { alias },
  // The fonts and the core come from mobile/, outside this root. TEF_NOTES_SERVER: the server `bun dev` talks to.
  server: { fs: { allow: [at("..")] }, proxy: process.env.TEF_NOTES_SERVER ? Object.fromEntries(["/api", "/agent"].map((p) => [p, { target: process.env.TEF_NOTES_SERVER, changeOrigin: true }])) : undefined },
  build: { outDir: "dist", emptyOutDir: true },
});
