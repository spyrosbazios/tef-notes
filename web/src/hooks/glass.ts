// The glass (lib/glass.ts) of the theme in force (hooks/appearance.ts), for a React surface.
import { useMemo } from "react";
import { THEMES } from "@/core/theme";
import { glass, type Glass } from "@/lib/glass";
import { useShownLook } from "./appearance";

export function useGlass(shape?: Glass): Glass {
  const { theme, scheme } = useShownLook();
  const key = JSON.stringify(shape ?? {});   // a literal passed each render is the same key, so nothing recomputes
  return useMemo(() => glass(THEMES[theme].C.raised, scheme, JSON.parse(key) as Glass), [theme, scheme, key]);
}
