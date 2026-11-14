// The site's own washes of a theme: the glow behind the hero, a glass fill for cards, the brand's hairline. All of them
// tints made with theme.ts's `alpha`. It sits beside the config and not in src/, because both sides read it: at build,
// vite-plugins.ts writes the default theme's into the page's CSS; in the browser, `scoped` (src/components/ui.tsx) sets any
// theme's on one element, which is how the promo film (../video) draws in a theme.
import { alpha, type Theme } from "../packages/core/src/theme";

export const washes = (t: Theme): Record<string, string> => ({
  glow: alpha(t.C.brand, 0.32),
  "glow-soft": alpha(t.C.brand, 0.12),
  "brand-line": alpha(t.C.brand, 0.4),
  glass: alpha(t.C.card, 0.62),
  hair: alpha(t.C.fg, 0.08),
});
