// What the site takes from the app: the palette as CSS variables and the icon as the favicon (the core's plugins,
// packages/core/vite.ts, with the site's own washes added), and the import aliases.
import { fileURLToPath } from "node:url";
import type { Alias, Plugin } from "vite";
import { CORE_SRC, identity, theme as palette } from "../packages/core/vite";
import { washes } from "./washes";

export { identity };

export const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export const alias: Alias[] = [
  { find: /^@\/core\//, replacement: CORE_SRC },
  { find: /^@\//, replacement: `${at("./src/")}` },
];

/** The default theme's palette plus the site's own washes of it (washes.ts). */
export const theme = (): Plugin => palette(washes);
