// Settings → Appearance: the theme and the primary colour.
import { Check } from "lucide-react";
import { ACCENT_NAMES, ACCENTS, accentColor, THEME_NAMES, THEMES, withAccent, type AccentName, type ThemeName } from "@/core/theme";
import { TITLE } from "@/components/settings/style";
import { SwatchPicker } from "@/components/swatch-picker";
import { useAppearance } from "@/hooks/appearance";
import { cn } from "@/lib/utils";

/** What each theme is for, under its name (the phone's Settings words). */
const ABOUT: Record<ThemeName, string> = {
  oled: "True black. Easiest on the battery at night.",
  dark: "Dark grey, softer than black.",
  midnight: "Deep navy, cooler than grey.",
  forest: "Green-black, calm and earthy.",
  mocha: "Catppuccin's pastels on a cosy dark.",
  nord: "Arctic blue-grey, dimmed and calm.",
  rosepine: "Faux fur and pine: plum dark, rose brand.",
  tokyo: "Downtown lights on a night-blue ground.",
  gruvbox: "Retro groove: warm greys, cream text.",
  light: "Near-white, for daylight.",
  mist: "Cool blue-grey daylight.",
  dawn: "Soft blush paper, warm and bright.",
  sepia: "Warm paper, low glare for reading.",
  latte: "Catppuccin's pastels in daylight.",
  snow: "Nord's snow storm, inked in polar night.",
  solar: "Solarized's cream, blue on yellowed paper.",
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
    <section className="space-y-3" aria-labelledby="appearance-h">
      <h2 id="appearance-h" className={TITLE}>Appearance</h2>
      <div className="divide-y divide-line rounded-xl border border-line">
        <div className="px-3 py-2.5">
          <SwatchPicker wrap title="Primary colour" shown={label(accent)} swatches={ACCENT_NAMES.map((a) => {
            const colour = accentColor(THEMES[theme], a);
            return { key: a, label: label(a), on: a === accent, ring: colour, fill: { backgroundColor: colour }, pick: () => set({ accent: a }) };
          })} />
        </div>
        <div className="space-y-2.5 px-3 py-2.5">
          <p id="theme-h" className="text-sm font-semibold">Theme</p>
          <div role="radiogroup" aria-labelledby="theme-h" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
                  <span className="block text-[13px] leading-snug text-dim">{ABOUT[n]}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
