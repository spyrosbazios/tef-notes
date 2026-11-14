import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill } from "remotion";
import { scoped } from "@/components/ui";
import type { Theme } from "@/core/theme";

const Wearing = createContext<Theme | null>(null);

/** The theme the stage around a scene wears. */
export function useTheme() {
  const theme = useContext(Wearing);
  if (!theme) throw new Error("useTheme outside a Stage");
  return theme;
}

/** The film's ground in one theme: the page's colour, the hairline grid fading down from the top and the brand's glow
 *  behind it, as the site's hero has them. Everything inside draws in the theme. A scene that changes theme lays another
 *  Stage over this one (`style` clips it). */
export function Stage({ theme, style, children }: { theme: Theme; style?: CSSProperties; children?: ReactNode }) {
  return (
    <Wearing.Provider value={theme}>
      <AbsoluteFill style={{ ...scoped(theme), ...style }} className="overflow-hidden bg-bg font-sans text-fg antialiased">
        <div className="absolute inset-x-0 top-0 h-[70rem] bg-grid" />
        <div className="absolute inset-x-0 top-0 h-[44rem] bg-[radial-gradient(ellipse_55%_100%_at_50%_0%,var(--tf-glow),transparent_72%)] opacity-60" />
        {children}
      </AbsoluteFill>
    </Wearing.Provider>
  );
}
