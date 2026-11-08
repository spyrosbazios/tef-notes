// What the page's boot (vite-boot.ts, the inline script and the splash layer index.html is built with) and the app agree on.
// No imports: the build reads this file in Node, before any of the app exists.

/** Where this browser keeps its copy of the preferences (hooks/prefs.ts): the boot script reads the theme and accent from it. */
export const PREFS_STORAGE = "tefnotes.prefs";

/** The splash layer's element id; lib/splash.ts takes it away. */
export const SPLASH_ID = "splash";
