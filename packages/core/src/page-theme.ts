// The theme a WebView page (the editor, the PDF viewer) draws in, sent over its bridge: the palette as CSS variable
// values (`--tf-<name>`, the names web/src/index.css maps its tokens onto) and the scheme for `color-scheme`.
// Sent on load and again whenever the owner switches theme, so an open page follows without reloading.
export type PageTheme = { scheme: "dark" | "light"; vars: Record<string, string> };
