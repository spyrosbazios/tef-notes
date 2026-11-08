// The look: the theme and the accent (the owner's preferences, hooks/prefs.ts, so every device has the same), applied to the page
// the way the phone's WebView pages take theirs (page-theme.ts), so the same palette in theme.ts paints both.
import { useCallback, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { pageTheme, THEMES, withAccent, type AccentName, type ThemeName } from "@/core/theme";
import { lensAccent } from "@/core/lens";
import { applyPageTheme } from "@/page-theme";
import { useActiveLens } from "./lens";
import { calm } from "./media";
import { setPrefs, usePrefs } from "./prefs";

type Look = { theme: ThemeName; accent: AccentName };

/** The chosen theme and accent, and the scheme of the theme; `set` merges a pick and tells every hook using them, wiping the
 *  page from one look to the next (a View Transition, `::view-transition-new(root)` in index.css) unless the OS asks for less
 *  motion or the browser has none. Only a pick made here wipes: a lens's accent (`useApplyAppearance`) switches all day, so it cuts. */
export function useAppearance() {
  const { theme, accent } = usePrefs();
  const set = useCallback((patch: Partial<Look>) => {
    const apply = () => setPrefs(patch);
    // flushSync: the new look (and its layout effect, which writes the variables) is in the DOM when the browser takes the new snapshot.
    if (calm() || !document.startViewTransition) apply();
    else document.startViewTransition(() => flushSync(apply));
  }, []);
  return { theme, accent, scheme: THEMES[theme].scheme, set };
}

/** Puts the look on the page: the `--tf-*` variables, `color-scheme`, the `dark` class tailwind's variant reads, and
 *  `data-scheme`. The primary colour is the active lens's when it has one (core/lens.ts `lensAccent`), else the chosen one.
 *  Mounted once, in root.tsx's `Look`. */
export function useApplyAppearance() {
  const { theme, accent, scheme } = useAppearance();
  const shown = lensAccent(useActiveLens(), accent);
  // Before paint: a stored light theme doesn't flash the dark default.
  useLayoutEffect(() => {
    applyPageTheme(pageTheme(withAccent(THEMES[theme], shown)));
    const root = document.documentElement;
    root.classList.toggle("dark", scheme === "dark");
    root.dataset.scheme = scheme;
  }, [theme, shown, scheme]);
}
