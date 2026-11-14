import { THEMES, type ThemeName } from "@/core/theme";
import { useClock } from "../kit/clock";
import { Pair } from "../kit/Pair";
import { Scene, WideBody } from "../kit/Scene";
import { Stage, useTheme } from "../kit/Stage";
import type { Shot } from "../storyboard";

/** The themes the app is shown in after the film's own, in order: light and dark by turns. */
const TOUR: ThemeName[] = ["dawn", "nord", "sepia", "rosepine", "latte"];
/** When the first wipe begins, how long each theme has, and how much of that is the wipe. */
const START = 0.9, EACH = 0.72, WIPE = 0.5;

/** Home on both screens, and the whole frame with it, wiped from one theme into the next: each theme is a stage of its
 *  own laid over the last, cut along a slanted edge that crosses the frame. */
export function Themes({ shot }: { shot: Shot }) {
  const { t, ramp } = useClock();
  const stops = [useTheme(), ...TOUR.map((name) => THEMES[name])];
  const body = <WideBody shot={shot}><Pair browser={{ opacity: ramp(0.2, 0.8) }} phone={{ opacity: ramp(0.5, 0.8) }} /></WideBody>;
  return (
    <Scene seconds={shot.seconds}>
      {/* In the film's own theme, on the film's own stage, until the first wipe has covered it */}
      {t < START + WIPE ? body : null}
      {stops.map((theme, i) => {
        if (i === 0) return null;
        const edge = ramp(START + (i - 1) * EACH, WIPE) * 125; // the edge's top, in percent of the width; its foot trails by 25
        if (edge === 0 || t >= START + i * EACH + WIPE) return null; // not begun, or wholly under the next
        return <Stage key={theme.name} theme={theme} style={{ clipPath: `polygon(0 0, ${edge}% 0, ${edge - 25}% 100%, 0 100%)` }}>{body}</Stage>;
      })}
    </Scene>
  );
}
