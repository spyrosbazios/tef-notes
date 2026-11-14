import { existsSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { alias, at, identity, theme } from "./vite-plugins";

export default defineConfig({
  // "/" for a host of its own (the Dockerfile); the GitHub Pages workflow sets SITE_BASE=/tef-notes/.
  base: process.env.SITE_BASE ?? "/",
  plugins: [react(), tailwindcss(), theme(), identity()],
  resolve: { alias },
  // The promo film (../video) is rendered into public/ by the Pages workflow, never committed: the hero's screen is the
  // film only in a build that has the file (src/components/Hero.tsx).
  define: { __FILM__: JSON.stringify(existsSync(at("./public/film.mp4"))) },
  // The shared files (../packages/core) are built under this tsconfig.
  tsconfig: "./tsconfig.app.json",
  // The fonts (../assets) and the palette (../packages/core) come from outside this root.
  server: { fs: { allow: [at("..")] } },
  build: { outDir: "dist", emptyOutDir: true },
});
