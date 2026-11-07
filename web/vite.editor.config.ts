// The phone's editor: editor-host/ (the editor module plus a postMessage bridge) built into ONE html file, scripts,
// styles and fonts inline, which is written into the app as mobile/src/ui/editor-html.ts. `bun run build:editor`.
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { alias, at, intoApp, theme } from "./vite-shared";

export default defineConfig({
  plugins: [tailwindcss(), theme(), viteSingleFile(), intoApp({ host: "editor-host", out: "../mobile/src/ui/editor-html.ts", name: "EDITOR_HTML", script: "build:editor" })],
  resolve: { alias },
  server: { fs: { allow: [at("..")] } },
  build: { outDir: "dist-editor", emptyOutDir: true, rollupOptions: { input: at("editor-host/index.html") } },
});
