// This browser's look: the theme and the accent (localStorage, per browser, like the phone's pref), applied to the page
// the way the phone's WebView pages take theirs (page-theme.ts), so the same palette in theme.ts paints both.
import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";
import { ACCENT_NAMES, DEFAULT_ACCENT, DEFAULT_THEME, pageTheme, THEME_NAMES, THEMES, withAccent, type AccentName, type ThemeName } from "@/core/theme";
import { lensAccent } from "@/core/lens";
import { applyPageTheme } from "@/page-theme";
import { useActiveLens } from "./lens";

const KEY = "tefnotes.appearance";
type Look = { theme: ThemeName; accent: AccentName };
const listeners = new Set<() => void>();
let cached: { raw: string | null; look: Look } | undefined;

function read(): Look {
  const raw = localStorage.getItem(KEY);
  if (cached?.raw === raw) return cached.look;
  let look: Look = { theme: DEFAULT_THEME, accent: DEFAULT_ACCENT };
  try {
    const p = JSON.parse(raw ?? "{}");
    look = {
      theme: THEME_NAMES.find((n) => n === p.theme) ?? DEFAULT_THEME,
      accent: ACCENT_NAMES.find((a) => a === p.accent) ?? DEFAULT_ACCENT,
    };
  } catch { /* an unreadable setting is no setting */ }
  cached = { raw, look };
  return look;
}

/** This browser's theme and accent, and the scheme of the theme; `set` merges a pick and tells every hook using them. */
export function useAppearance() {
  const { theme, accent } = useSyncExternalStore((cb) => {
    listeners.add(cb);
    addEventListener("storage", cb);
    return () => { listeners.delete(cb); removeEventListener("storage", cb); };
  }, read);
  const set = useCallback((patch: Partial<Look>) => {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), ...patch }));
    listeners.forEach((l) => l());
  }, []);
  return { theme, accent, scheme: THEMES[theme].scheme, set };
}

/** Puts the look on the page: the `--tf-*` variables, `color-scheme`, the `dark` class tailwind's variant reads, and
 *  `data-scheme`. The primary colour is the active lens's when it has one (core/lens.ts `lensAccent`), else this browser's.
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
