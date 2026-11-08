// The web manifest in the owner's theme (manifest.pb.js). Android builds the installed app's splash from the manifest's
// `background_color` and `theme_color`, which the web build writes in the default theme's ground; the server serves the
// same manifest, at the same address (Chrome stops updating an installed app whose manifest moved), with the chosen theme's
// ground instead. `colors` is the build's `manifest-colors.json` (packages/core/vite.ts): theme name to ground; `prefs` the
// owner's preferences record's `data` (packages/core/src/prefs.ts), read defensively: anything unknown keeps the manifest as built.

/** `manifest` with its colours set to the ground of `prefs.theme`, when `colors` knows it. */
function themed(manifest, colors, prefs) {
  const theme = prefs && typeof prefs === "object" && typeof prefs.theme === "string" ? prefs.theme : null;
  const bg = theme && colors && typeof colors === "object" && typeof colors[theme] === "string" ? colors[theme] : null;
  return bg ? { ...manifest, theme_color: bg, background_color: bg } : manifest;
}

module.exports = { themed };
