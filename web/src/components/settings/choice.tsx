import { Button } from "@/components/ui/button";

/** A row of small radio buttons (Settings). `off`: the options that can't be picked now. */
export function Choice<T extends string>({ label, value, options, names, onPick, off }: {
  label: string; value: T; options: readonly T[]; names: Record<T, string>; onPick: (v: T) => void; off?: (v: T) => boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Button key={o} type="button" role="radio" aria-checked={o === value} size="sm" variant={o === value ? "default" : "outline"}
          disabled={o !== value && off?.(o)} onClick={() => onPick(o)}>{names[o]}</Button>
      ))}
    </div>
  );
}
