import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Mark } from "@/components/ui";
import { rise, useClock } from "../kit/clock";
import { Scene } from "../kit/Scene";
import { OPENING } from "../storyboard";

/** The mark lands, the name comes up beside it, then the site's headline under both. */
export function Opening() {
  const { ramp } = useClock();
  const land = spring({ frame: useCurrentFrame(), fps: useVideoConfig().fps, config: { damping: 13, mass: 0.7 } });
  return (
    <Scene seconds={OPENING.seconds}>
      <div className="flex h-full flex-col items-center justify-center gap-12">
        <div className="flex items-center gap-7">
          <div style={{ opacity: Math.min(1, land * 2), transform: `scale(${0.5 + land * 0.5})` }}><Mark className="h-[120px]" /></div>
          <span style={rise(ramp(0.35), 0)} className="text-[96px] font-extrabold leading-none tracking-[-0.03em]">TEF Notes</span>
        </div>
        <h1 style={rise(ramp(0.9, 0.7), 30)} className="text-[104px] font-extrabold leading-[0.98] tracking-[-0.045em]">
          {OPENING.line}{" "}
          <span className="bg-gradient-to-b from-fg via-brand to-brand bg-clip-text text-transparent">{OPENING.accent}</span>
        </h1>
      </div>
    </Scene>
  );
}
