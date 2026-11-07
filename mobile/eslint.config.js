// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // the generated WebView pages (see README, "Generated files") are large bundles, not source
    ignores: ["dist/*", "src/ui/editor-html.ts", "src/ui/pdf-html.ts"],
  }
]);
