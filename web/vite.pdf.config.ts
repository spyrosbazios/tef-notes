// The phone's PDF viewer: pdf-host/ (pdf.js plus a postMessage bridge) built into ONE html file, which is written into
// the app as mobile/src/ui/pdf-html.ts. `bun run build:pdf`.
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { alias, at, intoApp, theme } from "./vite-shared";

export default defineConfig({
  plugins: [tailwindcss(), theme(), viteSingleFile(), intoApp({ host: "pdf-host", out: "../mobile/src/ui/pdf-html.ts", name: "PDF_HTML", script: "build:pdf" })],
  resolve: { alias },
  server: { fs: { allow: [at("..")] } },
  build: { outDir: "dist-pdf", emptyOutDir: true, rollupOptions: { input: at("pdf-host/index.html") } },
});
