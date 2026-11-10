// The ONE palette, one per theme. ../vite.ts writes the default into the web app's, the site's and the extension's CSS, so
// no colour is written twice; the web app re-sets the variables to the user's pick at runtime (web/src/hooks/appearance.ts).
import type { Color } from "./notes";
import type { PageTheme } from "./page-theme";

export type Palette = {
  bg: string; card: string; raised: string; line: string;
  fg: string; dim: string; faint: string;
  brand: string; up: string; down: string; warn: string;
};

export type NoteColors = Record<Color, { bg: string; fg: string; line: string }>;

/** The red, green and blue of `hex` (#rrggbb), 0..255 each. */
export function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/** `hex` (#rrggbb) at opacity `a` (0..1), as rgba(): a tint of a palette colour, never a hex with digits glued on. */
export function alpha(hex: string, a: number) {
  return `rgba(${channels(hex).join(", ")}, ${a})`;
}

/** Translucent fills, named once for both CSS outputs: `muted` a pressed or tonal fill, `accent` a selected one (brand
 *  tint; also shadcn's on the web: a raised opaque vanished on popovers); `brand-soft`/`brand-line` a brand-coloured section; soft/subtle are the status washes; `scrim`
 *  dims what lies under a sheet or a dialog. */
function tints(C: Palette) {
  return {
    muted: alpha(C.fg, 0.07),
    accent: alpha(C.brand, 0.14),
    // A section in the brand's colour (Home's progress card): its wash and its edge
    "brand-soft": alpha(C.brand, 0.1),
    "brand-line": alpha(C.brand, 0.26),
    "down-soft": alpha(C.down, 0.06),
    "down-subtle": alpha(C.down, 0.16),
    "up-soft": alpha(C.up, 0.06),
    "up-subtle": alpha(C.up, 0.16),
    "warn-soft": alpha(C.warn, 0.06),
    "warn-subtle": alpha(C.warn, 0.16),
    scrim: alpha("#000000", 0.55),
  };
}

export type Tint = ReturnType<typeof tints>;

export type Theme = {
  name: ThemeName;
  label: string;
  /** What `color-scheme` (scrollbars, form controls) and the installed app's system bars follow. */
  scheme: "dark" | "light";
  C: Palette;
  TINT: Tint;
  NOTE_COLORS: NoteColors;
};

export const THEME_NAMES = [
  "oled", "dark", "midnight", "forest", "mocha", "nord", "rosepine", "tokyo", "gruvbox",
  "light", "mist", "dawn", "sepia", "latte", "snow", "solar",
] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

function theme(name: ThemeName, label: string, scheme: Theme["scheme"], C: Palette, NOTE_COLORS: NoteColors): Theme {
  return { name, label, scheme, C, TINT: tints(C), NOTE_COLORS };
}

/** The note colours most themes share: dark-ground washes and light-ground papers. */
const DARK_NOTES: NoteColors = {

  yellow: { bg: "#332e1b", fg: "#f0e4bd", line: "#a89150" },
  pink: { bg: "#35222b", fg: "#f3d3df", line: "#b26f88" },
  blue: { bg: "#1d2a3a", fg: "#d2e2f3", line: "#6a92bd" },
  green: { bg: "#1e3227", fg: "#cfeadb", line: "#64a37b" },
  purple: { bg: "#2b243c", fg: "#e0d6f3", line: "#9079bf" },
  gray: { bg: "#272a31", fg: "#e3e5ea", line: "#7b818c" },
  red: { bg: "#381f1f", fg: "#f3d2d0", line: "#b86a66" },
  orange: { bg: "#382a1b", fg: "#f3dcc6", line: "#b5814f" },
  teal: { bg: "#1a3233", fg: "#cdebe8", line: "#5aa39c" },
};
const LIGHT_NOTES: NoteColors = {

  yellow: { bg: "#fdf3c4", fg: "#3d3305", line: "#c9a227" },
  pink: { bg: "#fbdde8", fg: "#4a1c2e", line: "#c76b8d" },
  blue: { bg: "#d9e8fa", fg: "#13304f", line: "#5b8cc4" },
  green: { bg: "#d7f0df", fg: "#143823", line: "#5aa274" },
  purple: { bg: "#e8defa", fg: "#2c1d4d", line: "#8d72c9" },
  gray: { bg: "#e7e8ec", fg: "#26292f", line: "#8a909b" },
  red: { bg: "#fbdcdc", fg: "#4a1515", line: "#c96262" },
  orange: { bg: "#fde3cc", fg: "#4a2a0c", line: "#d08840" },
  teal: { bg: "#d2f0ec", fg: "#0f3a36", line: "#4a9e95" },
};
/** Note colours on paper (sepia, Solarized): the same hues warmed toward the ground. */
const PAPER_NOTES: NoteColors = {
  yellow: { bg: "#f7e7a8", fg: "#3d3005", line: "#b8962e" },
  pink: { bg: "#f2d3cf", fg: "#4a1f1c", line: "#b9695f" },
  blue: { bg: "#d6e1e6", fg: "#1d3440", line: "#6a8fa3" },
  green: { bg: "#dbe5c6", fg: "#26361a", line: "#7a9a55" },
  purple: { bg: "#e3d6e3", fg: "#3a2540", line: "#91709a" },
  gray: { bg: "#e3dccd", fg: "#3b352a", line: "#9a8f7a" },
  red: { bg: "#efd0c4", fg: "#4a1c14", line: "#b25e4a" },
  orange: { bg: "#f2dcbc", fg: "#47290d", line: "#b87a3a" },
  teal: { bg: "#d2e2da", fg: "#1d3a35", line: "#5f9488" },
};

/** Note colours (a card's tint, a tag's badge) on a dark ground: a dark wash of the hue, text a pale tint of it (~12:1), `line` the mid-tone that
 *  marks it — tile edge, checkbox, the list's colour dot. Paper-bright tiles would glare at night. On a light ground
 *  the reverse: pale paper, dark ink of the hue. */
export const THEMES: Record<ThemeName, Theme> = {
  // Surfaces climb a visible step each (bg, card, raised): a section reads as its own colour, not a hairline.
  // True-black bg, near-black surfaces, hairline borders, one violet brand; green for up/success.
  oled: theme("oled", "OLED black", "dark", {
    bg: "#000000", card: "#111115", raised: "#1c1c22", line: "#2a2a32",
    fg: "#f1f1f5", dim: "#8b8d98", faint: "#4f515b",
    brand: "#b39bff", up: "#5ce68a", down: "#ff5d5d", warn: "#f2b84b",
  }, {
    yellow: { bg: "#2b2716", fg: "#f0e4bd", line: "#a89150" },
    pink: { bg: "#2d1c24", fg: "#f3d3df", line: "#b26f88" },
    blue: { bg: "#172331", fg: "#d2e2f3", line: "#6a92bd" },
    green: { bg: "#182a20", fg: "#cfeadb", line: "#64a37b" },
    purple: { bg: "#241e33", fg: "#e0d6f3", line: "#9079bf" },
    gray: { bg: "#1f2228", fg: "#e3e5ea", line: "#7b818c" },
    red: { bg: "#2e1a1a", fg: "#f3d2d0", line: "#b86a66" },
    orange: { bg: "#2e2216", fg: "#f3dcc6", line: "#b5814f" },
    teal: { bg: "#14292a", fg: "#cdebe8", line: "#5aa39c" },
  }),
  // Material-style dark grey: the surfaces a step apart in lightness rather than hairlines on black.
  dark: theme("dark", "Dark grey", "dark", {
    bg: "#111113", card: "#1c1c20", raised: "#28282e", line: "#36363e",
    fg: "#e8e8ee", dim: "#9a9ca8", faint: "#5c5e69",
    brand: "#b39bff", up: "#5ce68a", down: "#ff6b6b", warn: "#f2b84b",
  }, DARK_NOTES),
  // Deep navy: blue-black surfaces, a sky-blue brand.
  midnight: theme("midnight", "Midnight", "dark", {
    bg: "#0b1020", card: "#141b2e", raised: "#1d263d", line: "#2a3550",
    fg: "#e6ebf5", dim: "#94a0b8", faint: "#56617a",
    brand: "#8ab4ff", up: "#5ce68a", down: "#ff6b6b", warn: "#f2b84b",
  }, DARK_NOTES),
  // Mossy green-black: earthy surfaces, a sage brand.
  forest: theme("forest", "Forest", "dark", {
    bg: "#0d1411", card: "#16201b", raised: "#1f2b25", line: "#2c3a33",
    fg: "#e4ede7", dim: "#94a69b", faint: "#56665c",
    brand: "#86d6a4", up: "#7fdc8f", down: "#ff7a6b", warn: "#e8c15a",
  }, DARK_NOTES),
  // Material 3 light: near-white ground, a deeper violet that holds AA on it (6.4:1).
  light: theme("light", "Light", "light", {
    bg: "#f7f6fa", card: "#ffffff", raised: "#efedf4", line: "#dedbe6",
    fg: "#1b1b21", dim: "#5e5c69", faint: "#9a98a5",
    brand: "#6750a4", up: "#1e7d45", down: "#c62828", warn: "#9a6200",
  }, LIGHT_NOTES),
  // Cool blue-grey daylight, a slate-blue brand (AA on the ground).
  mist: theme("mist", "Mist", "light", {
    bg: "#eef2f6", card: "#f8fafc", raised: "#e2e8ef", line: "#cfd8e2",
    fg: "#18212b", dim: "#55616f", faint: "#929dab",
    brand: "#2f5f9e", up: "#1e7d45", down: "#c62828", warn: "#9a6200",
  }, LIGHT_NOTES),
  // Soft blush paper, a deep rose brand.
  dawn: theme("dawn", "Dawn", "light", {
    bg: "#fbf3f2", card: "#ffffff", raised: "#f3e6e4", line: "#e6d4d1",
    fg: "#2a1d1f", dim: "#6b5558", faint: "#a8939a",
    brand: "#a8325a", up: "#2e7d4f", down: "#b3261e", warn: "#8f5f00",
  }, LIGHT_NOTES),
  // Warm paper: brown ink, a rust brand (5.9:1 on the ground).
  sepia: theme("sepia", "Sepia", "light", {
    bg: "#f4ecd8", card: "#ece2c9", raised: "#e4d8bb", line: "#d5c7a5",
    fg: "#3b2f22", dim: "#6f604c", faint: "#a39479",
    brand: "#9c4a1f", up: "#3f7a33", down: "#b3261e", warn: "#8f5f00",
  }, PAPER_NOTES),
  // Catppuccin Mocha (catppuccin.com/palette): mantle ground, base cards, the surfaces above; mauve for the brand.
  mocha: theme("mocha", "Mocha", "dark", {
    bg: "#181825", card: "#1e1e2e", raised: "#313244", line: "#45475a",
    fg: "#cdd6f4", dim: "#a6adc8", faint: "#6c7086",
    brand: "#cba6f7", up: "#a6e3a1", down: "#f38ba8", warn: "#f9e2af",
  }, DARK_NOTES),
  // Nord (nordtheme.com): Polar Night surfaces, Snow Storm text, Frost for the brand, Aurora for the states. The red is
  // lifted a step from nord11 to hold 4.5:1 on the ground.
  nord: theme("nord", "Nord", "dark", {
    bg: "#2e3440", card: "#3b4252", raised: "#434c5e", line: "#4c566a",
    fg: "#eceff4", dim: "#b4bdcd", faint: "#7b88a1",
    brand: "#88c0d0", up: "#a3be8c", down: "#de858c", warn: "#ebcb8b",
  }, DARK_NOTES),
  // Rosé Pine (rosepinetheme.com): base, surface, overlay; rose for the brand, foam for done, love for danger, gold to warn.
  rosepine: theme("rosepine", "Rosé Pine", "dark", {
    bg: "#191724", card: "#1f1d2e", raised: "#26233a", line: "#403d52",
    fg: "#e0def4", dim: "#908caa", faint: "#6e6a86",
    brand: "#ebbcba", up: "#9ccfd8", down: "#eb6f92", warn: "#f6c177",
  }, DARK_NOTES),
  // Tokyo Night (folke/tokyonight.nvim): the night ground with Storm's surfaces on it, its blue for the brand.
  tokyo: theme("tokyo", "Tokyo Night", "dark", {
    bg: "#1a1b26", card: "#1f2335", raised: "#292e42", line: "#3b4261",
    fg: "#c0caf5", dim: "#9aa5ce", faint: "#565f89",
    brand: "#7aa2f7", up: "#9ece6a", down: "#f7768e", warn: "#e0af68",
  }, DARK_NOTES),
  // Gruvbox dark, hard contrast (morhetz/gruvbox): retro warm greys, cream text, the bright orange as brand; its own
  // warm note washes (DARK_NOTES lean cool).
  gruvbox: theme("gruvbox", "Gruvbox", "dark", {
    bg: "#1d2021", card: "#282828", raised: "#3c3836", line: "#504945",
    fg: "#ebdbb2", dim: "#a89984", faint: "#7c6f64",
    brand: "#fe8019", up: "#b8bb26", down: "#fb4934", warn: "#fabd2f",
  }, {
    yellow: { bg: "#35301a", fg: "#f0e0a8", line: "#b8962e" },
    pink: { bg: "#35222a", fg: "#f3d0d8", line: "#c2788a" },
    blue: { bg: "#1f2d31", fg: "#cfe3e0", line: "#6d9a8e" },
    green: { bg: "#25301a", fg: "#dce8b8", line: "#8aa83a" },
    purple: { bg: "#302430", fg: "#ecd4de", line: "#b07a90" },
    gray: { bg: "#2c2a27", fg: "#e5dccb", line: "#8a8070" },
    red: { bg: "#3a2220", fg: "#f3d0c8", line: "#c4635a" },
    orange: { bg: "#3a2a1a", fg: "#f3dcc0", line: "#c47a3a" },
    teal: { bg: "#1c3028", fg: "#cfe8d8", line: "#6aa080" },
  }),
  // Catppuccin Latte: mantle ground, base cards, crust raised, surface0 lines; mauve for the brand. Its text is a step
  // darker than Catppuccin's (theirs is 6.6:1) and its green and yellow deepened, to hold AA on the ground.
  latte: theme("latte", "Latte", "light", {
    bg: "#e6e9ef", card: "#eff1f5", raised: "#dce0e8", line: "#ccd0da",
    fg: "#3c3f5a", dim: "#5f627a", faint: "#8e92a3",
    brand: "#8839ef", up: "#22791a", down: "#d20f39", warn: "#915a05",
  }, LIGHT_NOTES),
  // Nord's Snow Storm as the ground, Polar Night as ink; nord10 and the Aurora states each deepened a step to hold AA.
  snow: theme("snow", "Snow", "light", {
    bg: "#e5e9f0", card: "#eceff4", raised: "#d8dee9", line: "#c5cedb",
    fg: "#2e3440", dim: "#4c566a", faint: "#8c97ab",
    brand: "#456691", up: "#427326", down: "#a43f49", warn: "#80601a",
  }, LIGHT_NOTES),
  // Solarized light (ethanschoonover.com/solarized): base2 ground, base3 cards, base03 ink; the accents, drawn for
  // equal lightness, are each deepened a step so they read as text.
  solar: theme("solar", "Solarized", "light", {
    bg: "#eee8d5", card: "#fdf6e3", raised: "#e8e0c6", line: "#d6cdae",
    fg: "#073642", dim: "#536970", faint: "#8a9999",
    brand: "#1a68a6", up: "#5f7000", down: "#c42d2a", warn: "#7f6000",
  }, PAPER_NOTES),
};

export const DEFAULT_THEME: ThemeName = "oled";

/** The primary colour, picked over any theme in Settings > Appearance: `theme` keeps the theme's own brand. Each accent
 *  has a tone for dark grounds (pale, ~8:1 on black) and one for light grounds (deep, AA on white and on sepia paper). */
export const ACCENT_NAMES = ["theme", "violet", "indigo", "blue", "sky", "cyan", "teal", "mint", "green", "lime", "yellow", "amber", "orange", "coral", "red", "rose", "pink", "magenta", "slate"] as const;
export type AccentName = (typeof ACCENT_NAMES)[number];

export const ACCENTS: Record<Exclude<AccentName, "theme">, { label: string; dark: string; light: string }> = {
  violet: { label: "Violet", dark: "#b39bff", light: "#6750a4" },
  indigo: { label: "Indigo", dark: "#a5b0ff", light: "#3949ab" },
  blue: { label: "Blue", dark: "#8ab4ff", light: "#1f5fbf" },
  sky: { label: "Sky", dark: "#7dd3fc", light: "#0369a1" },
  cyan: { label: "Cyan", dark: "#67e0ef", light: "#00727f" },
  teal: { label: "Teal", dark: "#5fd4c4", light: "#00796b" },
  mint: { label: "Mint", dark: "#86efc0", light: "#047857" },
  green: { label: "Green", dark: "#7fdc8f", light: "#2e7d32" },
  lime: { label: "Lime", dark: "#bef264", light: "#4d7c0f" },
  yellow: { label: "Yellow", dark: "#fde047", light: "#806600" },
  amber: { label: "Amber", dark: "#f5c451", light: "#8a5a00" },
  orange: { label: "Orange", dark: "#ffa070", light: "#b8460b" },
  coral: { label: "Coral", dark: "#ff9e8a", light: "#b23a24" },
  red: { label: "Red", dark: "#ff8a80", light: "#c62828" },
  rose: { label: "Rose", dark: "#ff8fa3", light: "#b3264a" },
  pink: { label: "Pink", dark: "#f39ce0", light: "#9c2780" },
  magenta: { label: "Magenta", dark: "#e8a0ff", light: "#8e24aa" },
  slate: { label: "Slate", dark: "#b8c4d6", light: "#475569" },
};

export const DEFAULT_ACCENT: AccentName = "theme";

/** The colour an accent shows on a theme (the theme's own brand for `theme`). */
export const accentColor = (t: Theme, a: AccentName) => (a === "theme" ? t.C.brand : ACCENTS[a][t.scheme]);

const accented = new Map<string, Theme>();
/** A theme with its brand swapped for an accent and the brand tints made again. One object per pair, so what holds
 *  the result in an effect's dependencies sees a change only when the pick changes. */
export function withAccent(t: Theme, a: AccentName): Theme {
  if (a === "theme") return t;
  const key = `${t.name}:${a}`;
  let out = accented.get(key);
  if (!out) {
    const C = { ...t.C, brand: ACCENTS[a][t.scheme] };
    out = { ...t, C, TINT: tints(C) };
    accented.set(key, out);
  }
  return out;
}

/** The default theme, for what has one look only: the site, the extension, and the web app before the owner's pick applies. */
export const { C, TINT, NOTE_COLORS } = THEMES[DEFAULT_THEME];

/** A theme as flat CSS variable names (without the `--tf-` prefix) to values: the palette, the tints and
 *  `note-<colour>-<part>`. The web app's stylesheet reads these. */
export function themeVars(t: Theme): Record<string, string> {
  return Object.fromEntries([
    ...Object.entries(t.C),
    ...Object.entries(t.TINT),
    ...Object.entries(t.NOTE_COLORS).flatMap(([c, p]) => Object.entries(p).map(([k, v]) => [`note-${c}-${k}`, v])),
  ]);
}

/** A theme as the page takes it (core/page-theme.ts). */
export const pageTheme = (t: Theme): PageTheme => ({ scheme: t.scheme, vars: themeVars(t) });
