// Settings → Appearance: the theme and the primary colour.
import { Check } from "lucide-react";
import { ACCENT_NAMES, ACCENTS, accentColor, THEME_NAMES, THEMES, withAccent, type AccentName, type ThemeName } from "@/core/theme";
import { Group, Page } from "@/components/settings/kit";
import { SwatchPicker } from "@/components/swatch-picker";
import { useAppearance } from "@/hooks/appearance";
import { cn } from "@/lib/utils";

/** What each theme is, under its name. */
const ABOUT: Record<ThemeName, string> = {
  oled: "True black, kind to the battery",
  dark: "Dark grey, softer than black",
  midnight: "Deep navy",
  forest: "Green-black, earthy",
  mocha: "Catppuccin's pastels, dark",
  nord: "Arctic blue-grey",
  rosepine: "Plum dark, rose brand",
  tokyo: "City lights on night blue",
  gruvbox: "Warm greys, cream text",
  light: "Near-white, for daylight",
  mist: "Cool blue-grey daylight",
  dawn: "Soft blush paper",
  sepia: "Warm paper, low glare",
  latte: "Catppuccin's pastels, light",
  snow: "Nord's snow storm",
  solar: "Solarized's cream",
};

/** A theme's look in small: its ground, a card on it, and its brand (the picked accent on it). */
function ThemePreview({ name, accent }: { name: ThemeName; accent: AccentName }) {
  const { C } = withAccent(THEMES[name], accent);
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border" style={{ backgroundColor: C.bg, borderColor: C.line }}>
      <span className="flex h-5 w-6 items-end justify-end rounded-md p-[3px]" style={{ backgroundColor: C.card }}>
        <span className="size-2 rounded-full" style={{ backgroundColor: C.brand }} />
      </span>
    </span>
  );
}

export function Appearance() {
  const { theme, accent, set } = useAppearance();
  const label = (a: AccentName) => (a === "theme" ? `${THEMES[theme].label}'s own` : ACCENTS[a].label);
  return (
    <Page title="Appearance">
      <Group>
        <div className="px-3 py-2.5">
          <SwatchPicker wrap title="Primary colour" shown={label(accent)} swatches={ACCENT_NAMES.map((a) => {
            const colour = accentColor(THEMES[theme], a);
            return { key: a, label: label(a), on: a === accent, ring: colour, fill: { backgroundColor: colour }, pick: () => set({ accent: a }) };
          })} />
        </div>
      </Group>
      <Group title="Theme">
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-2 p-2.5 sm:grid-cols-4">
          {THEME_NAMES.map((n) => {
            const on = n === theme;
            return (
              <button key={n} type="button" role="radio" aria-checked={on} onClick={() => set({ theme: n })}
                className={cn("flex flex-col items-start gap-2 rounded-xl border-2 p-2.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "border-brand" : "border-line")}>
                <span className="flex w-full items-start justify-between">
                  <ThemePreview name={n} accent={accent} />
                  {on ? <Check className="size-4 text-brand" strokeWidth={2.6} /> : null}
                </span>
                <span className="block text-sm font-semibold">{THEMES[n].label}</span>
                <span className="block text-xs leading-snug text-dim">{ABOUT[n]}</span>
              </button>
            );
          })}
        </div>
      </Group>
    </Page>
  );
}
