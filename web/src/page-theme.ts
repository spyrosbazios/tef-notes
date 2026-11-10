// The app's active theme onto the page: each colour onto the `--tf-*` variable index.css maps its tokens from, and the
// scheme onto `color-scheme` (scrollbars, form controls).
import type { PageTheme } from "@/core/page-theme";

export function applyPageTheme({ scheme, vars }: PageTheme) {
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(vars)) root.setProperty(`--tf-${k}`, v);
  root.colorScheme = scheme;
  // The installed app's status and navigation bars are painted from this meta (identity() emits it with the default
  // theme's background); re-set it so they follow the chosen theme instead of staying the default's black.
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta && vars.bg) meta.content = vars.bg;
}
