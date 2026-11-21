// One row of round colour swatches, a radio group: the accent picker in Settings, and the colour and theme pickers of a
// lens. The caller says what each swatch is (its colour or gradient and the colour of its ring); this draws them.
import { Check } from "lucide-react";
import { useId, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

export type Swatch = {
  key: string;
  label: string;
  on: boolean;
  /** The ring round the picked swatch. */
  ring: string;
  /** The swatch's fill: `backgroundColor` or a gradient. */
  fill: CSSProperties;
  /** The tick's colour on the picked one: the page's ground by default. */
  tick?: string;
  /** Classes for the swatch's rim: a dashed one marks "none, the owner's own". */
  rim?: string;
  pick: () => void;
};

/** `wrap`: the swatches wrap over rows at a comfortable size (Settings); otherwise they are small and scroll sideways in one row (a lens's form). */
export function SwatchPicker({ title, shown, swatches, wrap = false }: { title: string; shown: string; swatches: Swatch[]; wrap?: boolean }) {
  const head = useId();
  return (
    <div className={wrap ? "space-y-2.5" : "space-y-2"}>
      <div className="flex items-baseline justify-between gap-2">
        <p id={head} className="text-sm font-semibold">{title}</p>
        <span className={wrap ? "text-[13px] text-dim" : "text-xs text-dim"}>{shown}</span>
      </div>
      <div role="radiogroup" aria-labelledby={head} className={wrap ? "flex flex-wrap gap-2" : "-mx-1 flex gap-1 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]"}>
        {swatches.map((s) => (
          <button key={s.key} type="button" role="radio" aria-checked={s.on} aria-label={s.label} title={s.label} onClick={s.pick}
            className={cn("grid shrink-0 place-items-center rounded-full border-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", wrap ? "size-11" : "size-9")}
            style={{ borderColor: s.on ? s.ring : "transparent" }}>
            <span className={cn("grid place-items-center overflow-hidden rounded-full", wrap ? "size-8" : "size-6", s.rim)} style={s.fill}>
              {s.on ? <Check className={cn(wrap ? "size-4" : "size-3.5", !s.tick && "text-bg")} style={s.tick ? { color: s.tick } : undefined} strokeWidth={3} /> : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
