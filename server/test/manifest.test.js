// lib/manifest.js: the web manifest recoloured to the owner's theme (manifest.pb.js).
import { describe, expect, test } from "bun:test";
import lib from "../pb_hooks/lib/manifest.js";
import { DEFAULT_THEME, THEMES } from "../../packages/core/src/theme";

const built = { name: "TEF Notes", start_url: "/", theme_color: THEMES[DEFAULT_THEME].C.bg, background_color: THEMES[DEFAULT_THEME].C.bg, icons: [] };
const colors = Object.fromEntries(Object.values(THEMES).map((t) => [t.name, t.C.bg]));

describe("themed", () => {
  test("the chosen theme's ground becomes both colours; the rest is as built", () => {
    const out = lib.themed(built, colors, { theme: "snow", accent: "violet" });
    expect(out).toEqual({ ...built, theme_color: THEMES.snow.C.bg, background_color: THEMES.snow.C.bg });
    expect(built.theme_color).toBe(THEMES[DEFAULT_THEME].C.bg);
  });
  test("no preferences, an unknown theme or no colours file: as built", () => {
    expect(lib.themed(built, colors, null)).toBe(built);
    expect(lib.themed(built, colors, { theme: "neon" })).toBe(built);
    expect(lib.themed(built, colors, { theme: 7 })).toBe(built);
    expect(lib.themed(built, null, { theme: "snow" })).toBe(built);
    expect(lib.themed(built, "x", { theme: "snow" })).toBe(built);
  });
});
