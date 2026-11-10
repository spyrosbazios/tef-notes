// The theme the web app paints itself in (web/src/page-theme.ts): the palette as CSS variable values (`--tf-<name>`, the
// names web/src/index.css maps its tokens onto) and the scheme for `color-scheme`. Applied on load and again whenever the
// owner switches theme, so the page follows without reloading.
export type PageTheme = { scheme: "dark" | "light"; vars: Record<string, string> };
