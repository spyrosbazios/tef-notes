// A note's pictures as a tile draws them: one fills, two split, three are one tall and two stacked, four are quarters
// (`mosaicCells`), a "+N" on the last when it has more. Each blurs in: the server's tiny copy, scaled up and blurred, at
// once, then the sharp one fading and un-blurring over it. A picture that fails drops out and the rest close up.
import { useState } from "react";
import { mosaicCells } from "@/core/notes";
import type { Source } from "@/hooks/thumbs";
import { cn } from "@/lib/utils";

/** One picture filling its box, blurred in. `onBroken`: the sharp one couldn't be loaded. */
export function BlurImage({ src, className, onBroken }: { src: Source; className?: string; onBroken?: () => void }) {
  const [tiny, setTiny] = useState(false), [sharp, setSharp] = useState(false);
  const fit = cn("absolute inset-0 size-full object-cover", src.page && "object-top");
  return (
    <div className={cn("relative overflow-hidden bg-raised", !tiny && !sharp && "animate-pulse", className)}>
      <img src={src.at("blur")} alt="" aria-hidden decoding="async" onLoad={() => setTiny(true)}
        className={cn(fit, "scale-110 blur-lg transition-opacity duration-200", tiny && !sharp ? "opacity-100" : "opacity-0")} />
      <img src={src.at("sharp")} alt="" loading="lazy" decoding="async" onLoad={() => setSharp(true)} onError={onBroken}
        className={cn(fit, "transition-[opacity,filter,scale] duration-500 ease-out", sharp ? "scale-100 opacity-100 blur-none" : "scale-105 opacity-0 blur-md")} />
    </div>
  );
}

/** The mosaic of `sources` filling its box; nothing when none can be drawn. `more`: pictures past the ones given. */
export function Mosaic({ sources, more = 0, className }: { sources: Source[]; more?: number; className?: string }) {
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const shown = sources.filter((s) => !broken.has(s.key));
  if (!shown.length) return null;
  const cells = mosaicCells(shown.length), extra = more + Math.max(0, shown.length - cells.length);
  return (
    <div className={cn("relative overflow-hidden bg-raised", className)}>
      {cells.map((c, i) => (
        <div key={shown[i].key} className="absolute p-px"
          style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }}>
          <BlurImage src={shown[i]} className="size-full" onBroken={() => setBroken((b) => new Set(b).add(shown[i].key))} />
          {i === cells.length - 1 && extra > 0 ? (
            <span className="absolute inset-px flex items-center justify-center bg-bg/55 font-semibold text-fg text-lg backdrop-blur-sm">+{extra}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
