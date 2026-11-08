// Liquid glass (quick-liquid): one material and tint for every glass surface, so the phone's tab bar, the assistant's button, the
// Notes header and the PDF counter are the same glass. The tint is the theme's raised surface at a touch over half, so a surface
// reads as the theme's and not as clear glass over whatever scrolls by; light and shadow follow the scheme. Only the optics: the
// motion stays Animate UI's. React surfaces take it from hooks/glass.ts; a page built outside React (pdf/pages.ts) from `glassOfPage`.
import type { LiquidGlassConfig } from "quick-liquid";
import { channels } from "@/core/theme";

export type Glass = Partial<LiquidGlassConfig>;

/** The glass over `raised` (the theme's raised surface, #rrggbb) in `scheme`; `shape` is the surface's own: its radius, a lighter material. */
export function glass(raised: string, scheme: "dark" | "light", shape: Glass = {}): Glass {
  return { material: "regular", borderRadius: 999, appearance: scheme, tint: channels(raised).join(", "), tintOpacity: 0.55, elevation: 0.7, ...shape };
}

/** The glass of the theme the page wears: its `--tf-raised` and `color-scheme` (page-theme.ts, set by the app or over a phone page's
 *  bridge). Before a theme arrives, the library's own tint. */
export function glassOfPage(shape: Glass = {}): Glass {
  const root = getComputedStyle(document.documentElement);
  const raised = root.getPropertyValue("--tf-raised").trim();
  const scheme = root.colorScheme === "light" ? "light" : "dark";
  return /^#[0-9a-f]{6}$/i.test(raised) ? glass(raised, scheme, shape) : { ...glass("#000000", scheme, shape), tint: undefined };
}
