// The look: the theme and the accent (the owner's preferences, hooks/prefs.ts, so every device has the same), applied to the page
// the way the phone's WebView pages take theirs (page-theme.ts), so the same palette in theme.ts paints both.
import { useCallback, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { pageTheme, THEMES, withAccent, type AccentName, type ThemeName } from "@/core/theme";
import { lensAccent, lensTheme } from "@/core/lens";
import { applyPageTheme } from "@/page-theme";
import { useActiveLens } from "./lens";
import { calm, typedTransitions } from "./media";
import { setPrefs, usePrefs } from "./prefs";

type Look = { theme: ThemeName; accent: AccentName };

/** The chosen theme and accent, and the scheme of the theme; `set` merges a pick and tells every hook using them, wiping the
 *  page from one look to the next (a View Transition, `::view-transition-new(root)` in index.css) unless the OS asks for less
 *  motion or the browser has no typed transitions. Only a pick made here wipes: a lens's accent (`useApplyAppearance`) switches all day, so it cuts. */
export function useAppearance() {
  const { theme, accent } = usePrefs();
  const set = useCallback((patch: Partial<Look>) => {
    const apply = () => setPrefs(patch);
    // flushSync: the new look (and its layout effect, which writes the variables) is in the DOM when the browser takes the new snapshot.
    // The type `look` is what index.css's wipe is scoped to, so a route's transition (router.ts) never plays it.
    if (calm() || !typedTransitions()) apply();
    else document.startViewTransition({ update: () => flushSync(apply), types: ["look"] });
  }, []);
  return { theme, accent, scheme: THEMES[theme].scheme, set };
}

/** The look in force: the active lens's theme and accent where it has them (core/lens.ts `lensTheme`, `lensAccent`), else
 *  the owner's. What surfaces paint with; the settings pane edits the owner's own (`useAppearance`). */
export function useShownLook() {
  const { theme: own, accent: ownAccent } = useAppearance(), lens = useActiveLens();
  const theme = lensTheme(lens, own);
  return { theme, accent: lensAccent(lens, ownAccent), scheme: THEMES[theme].scheme };
}

/** Puts the look on the page: the `--tf-*` variables, `color-scheme`, the `dark` class tailwind's variant reads, and
 *  `data-scheme`, of the look in force (`useShownLook`).
 *  Mounted once, in root.tsx's `Look`. */
export function useApplyAppearance() {
  const { theme, accent: shown, scheme } = useShownLook();
  // Before paint: a stored light theme doesn't flash the dark default.
  useLayoutEffect(() => {
    applyPageTheme(pageTheme(withAccent(THEMES[theme], shown)));
    const root = document.documentElement;
    root.classList.toggle("dark", scheme === "dark");
    root.dataset.scheme = scheme;
  }, [theme, shown, scheme]);
}
