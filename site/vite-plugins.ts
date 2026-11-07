// What the site takes from the app: the palette as CSS variables and the icon as the favicon (the core's plugins,
// packages/core/vite.ts, with the site's own washes added), and the import aliases.
import { fileURLToPath } from "node:url";
import type { Alias, Plugin } from "vite";
import { CORE_SRC, identity, theme as palette } from "../packages/core/vite";
import { alpha } from "../packages/core/src/theme";

export { identity };

export const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export const alias: Alias[] = [
  { find: /^@\/core\//, replacement: CORE_SRC },
  { find: /^@\//, replacement: `${at("./src/")}` },
];

/** The default theme's palette plus the site's own washes of it: the glow behind the hero, a glass fill for cards, the
 *  brand's hairline. All of them tints made with theme.ts's `alpha`. */
export const theme = (): Plugin =>
  palette((t) => ({
    glow: alpha(t.C.brand, 0.32),
    "glow-soft": alpha(t.C.brand, 0.12),
    "brand-line": alpha(t.C.brand, 0.4),
    glass: alpha(t.C.card, 0.62),
    hair: alpha(t.C.fg, 0.08),
  }));
