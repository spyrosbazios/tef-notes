import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { alias, at, identity, theme } from "./vite-plugins";

export default defineConfig({
  // "/" for a host of its own (the Dockerfile); the GitHub Pages workflow sets SITE_BASE=/tef-notes/.
  base: process.env.SITE_BASE ?? "/",
  plugins: [react(), tailwindcss(), theme(), identity()],
  resolve: { alias },
  // mobile/ has its own tsconfig (extending expo's, not installed here): the shared files are built under this one.
  tsconfig: "./tsconfig.app.json",
  // The fonts and the palette come from mobile/, outside this root.
  server: { fs: { allow: [at("..")] } },
  build: { outDir: "dist", emptyOutDir: true },
});
