// The web app's build helpers (vite.config.ts): the import aliases, and the core's plugins (packages/core/vite.ts: the palette's
// CSS variables and the tab's identity), the same ones the site and the extension build with.
import { fileURLToPath } from "node:url";
import type { Alias } from "vite";
import { CORE_SRC } from "../packages/core/vite";

export { identity, theme } from "../packages/core/vite";

export const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export const alias: Alias[] = [
  { find: /^@\/core\//, replacement: CORE_SRC },
  { find: /^@\//, replacement: `${at("./src/")}` },
];
