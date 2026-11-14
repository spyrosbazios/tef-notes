// A scene's frame and its two layouts. The frame fades up from the stage and back into it, so one scene hands over to the
// next on the same ground, and it is what a Tap (moves.tsx) is drawn over.
import { createContext, useContext, useState, type ReactNode } from "react";
import { AbsoluteFill } from "remotion";
import type { Shot } from "../storyboard";
import { rise, useClock } from "./clock";

const Frame = createContext<HTMLDivElement | null>(null);

/** The element of the scene around this, once it is on the page. */
export const useFrame = () => useContext(Frame);

export function Scene({ seconds, children }: { seconds: number; children: ReactNode }) {
  const { ramp } = useClock();
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  return (
    <AbsoluteFill ref={setEl} style={{ opacity: ramp(0, 0.35) * (1 - ramp(seconds - 0.3, 0.3)) }}>
      <Frame.Provider value={el}>{children}</Frame.Provider>
    </AbsoluteFill>
  );
}

/** The shot's words: the eyebrow, then the caption, each rising into place. */
export function Caption({ shot, wide }: { shot: Shot; wide?: boolean }) {
  const { ramp } = useClock();
  return (
    <div>
      <p style={rise(ramp(0.1))} className="text-[26px] font-semibold uppercase tracking-[0.18em] text-brand">{shot.eyebrow}</p>
      <h2 style={rise(ramp(0.22))} className={`mt-5 font-extrabold leading-[1.02] tracking-[-0.035em] text-balance ${wide ? "text-[76px]" : "text-[84px]"}`}>{shot.caption}</h2>
    </div>
  );
}

/** The words on the left, one device on the right: a phone, or a panel drawn at its own size. The device hangs from the
 *  top of the frame (its Enter says how far down), large enough to read, so a tall one runs off the foot. */
export function Split({ shot, children }: { shot: Shot; children: ReactNode }) {
  return (
    <Scene seconds={shot.seconds}>
      <div className="absolute left-[140px] top-0 flex h-full w-[720px] items-center"><Caption shot={shot} /></div>
      <div className="absolute left-[860px] top-0 flex w-[960px] justify-center">{children}</div>
    </Scene>
  );
}

/** The words on top and a wide shot under them, running off the foot of the frame as the site's hero does. Without a
 *  Scene of its own: a scene that lays several of these over each other (Themes) brings the one frame. */
export function WideBody({ shot, children }: { shot: Shot; children: ReactNode }) {
  return (
    <>
      <div className="absolute inset-x-0 top-[80px] text-center"><Caption shot={shot} wide /></div>
      <div className="absolute inset-x-0 top-[330px]">{children}</div>
    </>
  );
}

export const Wide = ({ shot, children }: { shot: Shot; children: ReactNode }) => <Scene seconds={shot.seconds}><WideBody shot={shot}>{children}</WideBody></Scene>;
