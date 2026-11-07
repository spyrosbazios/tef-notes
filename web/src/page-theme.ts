// A phone page (editor-host, pdf-host) takes the app's active theme over its bridge: each colour onto the `--tf-*`
// variable index.css maps its tokens from, and the scheme onto `color-scheme` (scrollbars, form controls).
import type { PageTheme } from "@/core/page-theme";

export function applyPageTheme({ scheme, vars }: PageTheme) {
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(vars)) root.setProperty(`--tf-${k}`, v);
  root.colorScheme = scheme;
}
