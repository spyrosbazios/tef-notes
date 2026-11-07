// The active theme. Uniwind holds which one it is (classes follow it by themselves); `useTheme()` gives the same
// palette as JS for what a class can't reach: icon colours, WebViews, navigator options. The theme and the accent over
// it (the primary colour) are device prefs; the accent reaches classes by overriding the theme's brand variables. While a
// lens with a colour of its own is on, that colour is the accent (core/lens.ts `lensAccent`).
import * as SystemUI from "expo-system-ui";
import { Appearance } from "react-native";
import { Uniwind, useUniwind } from "uniwind";
import { useEffect } from "react";
import { lensAccent } from "@/core/lens";
import { activeLensNow, useActiveLens } from "@/store/lenses";
import { usePrefs } from "@/store/prefs";
import { ACCENT_NAMES, DEFAULT_ACCENT, DEFAULT_THEME, THEME_NAMES, THEMES, withAccent, type AccentName, type Theme, type ThemeName } from "@/core/theme";

const known = (n: string): n is ThemeName => (THEME_NAMES as readonly string[]).includes(n);
const knownAccent = (a: string): a is AccentName => (ACCENT_NAMES as readonly string[]).includes(a);

/** The theme on screen now, with the accent over it: `{ name, label, scheme, C, TINT, NOTE_COLORS }`. Re-renders when either
 *  changes, and is the same object while neither does. */
export function useTheme(): Theme {
  const { theme } = useUniwind();
  const accent = usePrefs((s) => s.accent), lens = useActiveLens();
  return withAccent(THEMES[known(theme) ? theme : DEFAULT_THEME], lensAccent(lens, knownAccent(accent) ? accent : DEFAULT_ACCENT));
}

/** Puts the accent on screen again whenever the lens on (or its colour) changes. Mounted once, in the root layout. */
export function useLensLook() {
  const shown = useActiveLens()?.accent ?? null;
  useEffect(() => { const { theme, accent } = saved(); apply(theme, accent); }, [shown]);
}

/** Puts a theme and accent on screen: Uniwind's classes (the brand and its tint overridden for the accent), Android's
 *  night mode (keyboard, native pickers) and the window behind the app, so a screen transition never flashes another
 *  ground. Overriding with the theme's own values undoes an earlier accent. */
function apply(name: ThemeName, accent: AccentName) {
  const t = withAccent(THEMES[name], accent);
  Uniwind.setTheme(name);
  Uniwind.updateCSSVariables(name, { "--color-brand": t.C.brand, "--color-accent": t.TINT.accent });
  Appearance.setColorScheme(t.scheme);
  void SystemUI.setBackgroundColorAsync(t.C.bg);
}

const saved = () => {
  const { theme, accent } = usePrefs.getState();
  return { theme: known(theme) ? theme : DEFAULT_THEME, accent: lensAccent(activeLensNow(), knownAccent(accent) ? accent : DEFAULT_ACCENT) };
};

/** The saved theme with its accent, for what is drawn outside the app's views: the widgets (src/widget/). */
export const savedTheme = (): Theme => { const { theme, accent } = saved(); return withAccent(THEMES[theme], accent); };

/** The saved choice, once at launch (the root layout); a name no longer known falls back to the default. */
export function applySavedTheme() {
  const { theme, accent } = saved();
  apply(theme, accent);
}

/** The owner picked a theme: saved and shown at once, the accent kept. */
export function chooseTheme(name: ThemeName) {
  usePrefs.getState().set({ theme: name });
  apply(name, saved().accent);
}

/** The owner picked a primary colour: saved and shown at once on the current theme (unless a lens's colour is on). */
export function chooseAccent(accent: AccentName) {
  usePrefs.getState().set({ accent });
  const now = saved();
  apply(now.theme, now.accent);
}
