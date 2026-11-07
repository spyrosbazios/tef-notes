const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');

const config = getDefaultConfig(__dirname);

// The shared core (../packages/core) lives outside the app: Metro only reads files under its watch folders. The
// `@/core/*` specifier itself resolves through tsconfig.json's `paths`, which Expo's resolver honours.
config.watchFolders = [...config.watchFolders, path.resolve(__dirname, '../packages/core')];

// withUniwindConfig must stay the outermost wrapper. extraThemes: packages/core/src/theme.ts's THEME_NAMES past
// Uniwind's own light and dark (also package.json's typecheck `--theme`s), or Uniwind.setTheme throws for them.
module.exports = withUniwindConfig(config, {
  cssEntryFile: './src/global.css',
  extraThemes: ['oled', 'midnight', 'forest', 'mocha', 'nord', 'rosepine', 'tokyo', 'gruvbox', 'mist', 'dawn', 'sepia', 'latte', 'snow', 'solar'],
  dtsFile: './src/uniwind-types.d.ts',
});
