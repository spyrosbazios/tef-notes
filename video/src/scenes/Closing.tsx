import { GitBranch } from "lucide-react";
import { Brand } from "@/components/ui";
import { REPO } from "@/lib";
import { rise, useClock } from "../kit/clock";
import { Scene } from "../kit/Scene";
import { CLOSING } from "../storyboard";

/** The name, the README's line, where the source is, and what kind of software this is. */
export function Closing() {
  const { ramp } = useClock();
  return (
    <Scene seconds={CLOSING.seconds}>
      <div className="flex h-full flex-col items-center justify-center text-center">
        <div style={rise(ramp(0.1))} className="origin-bottom scale-[2.4]"><Brand /></div>
        <h1 style={rise(ramp(0.3, 0.7), 30)} className="mt-16 text-[104px] font-extrabold leading-[1.02] tracking-[-0.045em]">
          {CLOSING.line}<br />
          <span className="bg-gradient-to-b from-fg via-brand to-brand bg-clip-text text-transparent">{CLOSING.accent}</span>
        </h1>
        <p style={rise(ramp(0.9))} className="mt-16 flex h-[76px] items-center gap-4 rounded-full border border-line bg-glass px-10 text-[34px] font-semibold">
          <GitBranch className="size-9 text-brand" />{REPO.replace("https://", "")}
        </p>
        <ul style={rise(ramp(1.15))} className="mt-10 flex gap-10 text-[28px] text-dim">
          {CLOSING.notes.map((note) => <li key={note} className="flex items-center gap-10 before:size-2 before:rounded-full before:bg-brand first:before:hidden">{note}</li>)}
        </ul>
      </div>
    </Scene>
  );
}
