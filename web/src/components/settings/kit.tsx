// The parts every Settings page is built from, so the pages read alike: a page (its sticky title and an optional action), a
// group (a bordered box of rows, a small heading above it and one short hint under it), a row (an icon tile, a name, at most one
// line under it, its control at the end), and the controls a row ends in: a segmented choice for a few short options, a select
// for longer ones, a status dot for what can only be read. Words are kept to a minimum: an icon or a colour says it where it can.
import { GripVertical, type LucideIcon } from "lucide-react";
import { useId, type ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { RowDrag } from "@/hooks/drag";
import { cn } from "@/lib/utils";

/** A section page: its title stays at the top as the page scrolls, with `action` (an Add button) at its end. On the phone the
 *  page header already names the section, so the title is only read out there, and the action keeps the row. */
export function Page({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="space-y-6" aria-labelledby={id}>
      <div className={cn("sticky top-0 z-10 -mx-1 flex items-center gap-2 bg-bg/95 px-1 py-2 backdrop-blur", !action && "max-md:sr-only")}>
        <h2 id={id} className="min-w-0 flex-1 font-bold text-lg tracking-tight max-md:sr-only">{title}</h2>
        {action ? <span className="flex-1 md:hidden" /> : null}
        {action}
      </div>
      {children}
    </section>
  );
}

/** A box of rows. `title` sits above it with `action` at its end; `hint`, one short line, under it. */
export function Group({ title, action, hint, children, className }: {
  title?: string; action?: ReactNode; hint?: ReactNode; children: ReactNode; className?: string;
}) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={title ? id : undefined} className="@container space-y-2">
      {title || action ? (
        <div className="flex min-h-7 items-center gap-2 px-1">
          {title ? <h3 id={id} className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wider text-dim">{title}</h3> : <span className="flex-1" />}
          {action}
        </div>
      ) : null}
      <div className={cn("divide-y divide-line overflow-hidden rounded-xl border border-line", className)}>{children}</div>
      {hint ? <p className="px-1 text-xs leading-snug text-faint">{hint}</p> : null}
    </div>
  );
}

/** An icon in its tile: the row's sign. `tone` colours it; `off` greys it, for a row whose thing is hidden or switched off. */
export function IconTile({ icon: Icon, tone = "dim", off }: { icon: LucideIcon; tone?: Tone | "dim"; off?: boolean }) {
  return (
    <span aria-hidden className={cn("grid size-8 shrink-0 place-items-center rounded-lg transition-colors",
      off ? "bg-muted/50 text-faint" : tone === "dim" ? "bg-muted text-dim" : TONE_TILE[tone])}>
      <Icon className="size-4" />
    </span>
  );
}

/** A row: an icon tile, a name with at most a line under it, and its control. `below`: a control too wide for the end of the
 *  row (a list, a set of swatches), drawn under the name instead. `off`: the row's thing is hidden or off, so it is greyed. */
export function Row({ icon, tone, title, detail, children, below, off, lead, htmlFor }: {
  icon?: LucideIcon; tone?: Tone | "dim"; title: ReactNode; detail?: ReactNode; children?: ReactNode; below?: ReactNode; off?: boolean;
  /** Something before the icon: a drag handle. */ lead?: ReactNode;
  /** The control the name labels. */ htmlFor?: string;
}) {
  const name = cn("block text-sm font-medium break-words", off && "text-faint");
  return (
    <div className="space-y-2.5 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-36 items-center gap-3">
          {lead}
          {icon ? <IconTile icon={icon} tone={tone} off={off} /> : null}
          <div className="min-w-0 flex-1">
            {htmlFor ? <label htmlFor={htmlFor} className={name}>{title}</label> : <p className={name}>{title}</p>}
            {detail ? <p className="text-xs leading-snug text-dim">{detail}</p> : null}
          </div>
        </div>
        {children ? <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div> : null}
      </div>
      {below}
    </div>
  );
}

/** The colours a choice or a status can carry: the brand's, good, careful, stopped, or none. */
type Tone = "brand" | "up" | "warn" | "down" | "muted";
const TONE_ON: Record<Tone, string> = {
  brand: "data-[state=on]:bg-brand/15 data-[state=on]:text-brand",
  up: "data-[state=on]:bg-up/15 data-[state=on]:text-up",
  warn: "data-[state=on]:bg-warn/15 data-[state=on]:text-warn",
  down: "data-[state=on]:bg-down/15 data-[state=on]:text-down",
  muted: "data-[state=on]:bg-muted data-[state=on]:text-fg",
};
const TONE_TILE: Record<Tone, string> = { brand: "bg-brand/15 text-brand", up: "bg-up/15 text-up", warn: "bg-warn/15 text-warn", down: "bg-down/15 text-down", muted: "bg-muted text-dim" };
const TONE_DOT: Record<Tone, string> = { brand: "bg-brand", up: "bg-up", warn: "bg-warn", down: "bg-down", muted: "bg-faint" };

/** What a choice's option looks like: its name, and optionally its icon and tone. */
export type Option = { label: string; icon?: LucideIcon; tone?: Tone };

/** A few short options side by side, the picked one lit in its tone. `compact`: in a narrow group an option with an icon shows
 *  only the icon (its name is still read out and in its tooltip), for a choice repeated down a list whose group carries a `Legend`. */
export function Segmented<T extends string>({ label, value, options, of, onPick, off, compact, className }: {
  label: string; value: T; options: readonly T[]; of: (v: T) => Option; onPick: (v: T) => void;
  /** The options that can't be picked now. */ off?: (v: T) => boolean;
  compact?: boolean; className?: string;
}) {
  return (
    <ToggleGroup type="single" variant="outline" size="sm" spacing={0} aria-label={label} value={value}
      onValueChange={(v) => { if (v) onPick(v as T); }} className={cn("max-w-full flex-wrap", className)}>
      {options.map((o) => {
        const { label: name, icon: Icon, tone = "brand" } = of(o);
        return (
          <ToggleGroupItem key={o} value={o} aria-label={name} title={name} disabled={o !== value && off?.(o)}
            className={cn("gap-1.5 text-dim", TONE_ON[tone])}>
            {Icon ? <Icon /> : null}
            <span className={cn(compact && Icon && "@max-lg:sr-only")}>{name}</span>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

/** What a compact `Segmented`'s icons mean, shown above its group while the group is narrow and the options show only their icons. */
export function Legend<T extends string>({ options, of }: { options: readonly T[]; of: (v: T) => Option }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dim @lg:hidden">
      {options.map((o) => {
        const { label, icon: Icon } = of(o);
        return <span key={o} className="flex items-center gap-1">{Icon ? <Icon className="size-3.5" /> : null}{label}</span>;
      })}
    </span>
  );
}

/** More options, or longer names, than a `Segmented` holds: a menu showing the picked one. An option is its own flex row: the
 *  item's highlight wraps its children, and an svg on its own is a block, so a bare icon would sit on a line above its name. */
export function Choose<T extends string>({ label, value, options, of, onPick }: {
  label: string; value: T; options: readonly T[]; of: (v: T) => Option; onPick: (v: T) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onPick(v as T)}>
      <SelectTrigger size="sm" aria-label={label} className="min-w-32"><SelectValue /></SelectTrigger>
      <SelectContent align="end">
        {options.map((o) => {
          const { label: name, icon: Icon } = of(o);
          return <SelectItem key={o} value={o}><span className="flex items-center gap-2">{Icon ? <Icon className="text-dim" /> : null}{name}</span></SelectItem>;
        })}
      </SelectContent>
    </Select>
  );
}

/** A state read, not set: a dot in its tone and a word. */
export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-dim">
      <span aria-hidden className={cn("size-2 rounded-full", TONE_DOT[tone])} />{children}
    </span>
  );
}

/** A count or a short label beside a row's name. */
export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-muted px-2 text-[11px] font-medium tabular-nums text-dim [&_svg]:size-3", className)}>{children}</span>;
}

/** A list's row that is dragged into order (hooks/drag.ts): greyed while it moves, a line where it would land. */
export function DragItem({ drag, children }: { drag: RowDrag; children: ReactNode }) {
  return (
    <li {...drag.props} className={cn("relative select-none", drag.dragging && "opacity-40")}>
      {drag.mark ? <span aria-hidden className={cn("pointer-events-none absolute inset-x-3 z-10 h-0.5 rounded-full bg-brand", drag.mark === "before" ? "-top-px" : "-bottom-px")} /> : null}
      {children}
    </li>
  );
}

/** The handle a dragged row shows. */
export const Grip = () => <GripVertical aria-hidden className="-mx-1 size-4 shrink-0 cursor-grab text-faint" />;
