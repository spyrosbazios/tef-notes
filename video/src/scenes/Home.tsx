import { useClock, rise } from "../kit/clock";
import { Pair } from "../kit/Pair";
import { Wide } from "../kit/Scene";
import type { Shot } from "../storyboard";

/** The app on both its screens: the browser stands up from lying back, as the site's hero does on scroll, and the phone
 *  comes up over its corner. */
export function Home({ shot }: { shot: Shot }) {
  const { t, ramp } = useClock();
  const up = ramp(0.2, 1.2);
  return (
    <Wide shot={shot}>
      {/* Once both are up, the pair keeps coming a little closer, so the shot is never still */}
      <div style={{ perspective: 1600, transform: `scale(${1 + 0.035 * (t / shot.seconds)})`, transformOrigin: "50% 0" }}>
        <Pair
          browser={{ opacity: up, transform: `rotateX(${(1 - up) * 18}deg) scale(${1.05 - up * 0.05})`, transformOrigin: "50% 0" }}
          phone={rise(ramp(0.8, 0.9), 70)}
        />
      </div>
    </Wide>
  );
}
