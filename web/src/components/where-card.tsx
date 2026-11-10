// A task's Where (its `where` field, core/todo.ts; notes have no place): the
// picker that sets it, and once set a card: the place's map in the app's theme (the agent draws it, services/places.ts; a
// place with only a name has none), its name and address, and the two things a place is for: directions from where you
// are, and the place itself in Google Maps. On a phone both open the Maps app. The task's card has a Where row
// (task-detail.tsx).
import { ExternalLink, MapPin, Navigation, Pencil, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { directionsUrl, mapsUrl, type Place } from "@/core/places";
import { Pick } from "@/components/pick";
import { PlacePicker } from "@/components/place-picker";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useShownLook } from "@/hooks/appearance";
import { cn } from "@/lib/utils";
import { mapSrc } from "@/services/places";

/** The map picture's size as asked for, in CSS pixels: wide enough for the card's column, cropped to the card's height. */
const MAP_W = 640, MAP_H = 220;

/** Off the page, in a new tab or the Maps app. */
const away = { target: "_blank", rel: "noopener noreferrer" } as const;

/** The picker in a popover (a sheet on a phone) from `trigger`; closes on a pick. */
export function PlacePick({ trigger, start, title, onSet }: { trigger: React.ReactNode; start?: string; title: string; onSet: (p: Place) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Pick open={open} onOpenChange={setOpen} title={title} align="start" width="w-80" trigger={trigger}>
      {open ? <PlacePicker start={start} onPick={(p) => { setOpen(false); onSet(p); }} /> : null}
    </Pick>
  );
}

/** The map, a link to the place; gone when the server can't draw it (no coordinates, offline). */
function MapPicture({ where }: { where: Place }) {
  const { theme, accent: shown } = useShownLook();
  const src = mapSrc(where, MAP_W, MAP_H, theme, shown);
  const [state, setState] = useState<"loading" | "shown" | "broken">("loading");
  if (!src || state === "broken") return null;
  return (
    <a href={mapsUrl(where)} {...away} aria-label={`${where.name} in Google Maps`} tabIndex={-1}
      className={cn("relative block h-32 overflow-hidden border-b border-line bg-muted md:h-40", state === "loading" && "animate-pulse")}>
      <img key={src} src={src} alt="" loading="lazy" decoding="async" onLoad={() => setState("shown")} onError={() => setState("broken")}
        className={cn("size-full object-cover transition-opacity duration-300", state === "shown" ? "opacity-100" : "opacity-0")} />
    </a>
  );
}

function Icon({ label, children, ...p }: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={label} {...p}>{children}</Button></TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** A task's place, once it has one. `onSet(null)` takes it off (with a toast to put it back). Without `onSet` it
 *  is a preview (the assistant's confirm card): nothing to change, and only Open in Maps, to check it is the place meant. */
export function WhereCard({ where, onSet, className }: { where: Place; onSet?: (p: Place | null) => void; className?: string }) {
  const remove = () => {
    if (!onSet) return;
    onSet(null);
    toast(`Removed ${where.name}`, { action: { label: "Undo", onClick: () => onSet(where) } });
  };
  return (
    <section aria-label="Where" className={cn("@container overflow-hidden rounded-2xl border border-line bg-card", className)}>
      <MapPicture where={where} />
      <div className="flex items-start gap-3 px-3 pt-3">
        <span className="hidden size-9 shrink-0 place-items-center rounded-full bg-brand/10 text-brand @xs:grid"><MapPin className="size-4" /></span>
        <div className="min-w-0 flex-1 py-0.5">
          <p className="line-clamp-2 font-semibold text-sm">{where.name}</p>
          {where.address ? <p className="line-clamp-2 text-xs text-dim">{where.address}</p> : <p className="text-xs text-faint">No address: Maps searches by the name</p>}
        </div>
        {onSet ? (
          <>
            <PlacePick title="Change place" start={where.name} onSet={onSet} trigger={
              <Button variant="ghost" size="icon-sm" aria-label="Change place" title="Change place"><Pencil className="text-dim" /></Button>
            } />
            <Icon label="Remove place" onClick={remove}><X className="text-dim" /></Icon>
          </>
        ) : null}
      </div>
      {/* Under the name once the card is wide enough for the pin beside it (a container query: the card is as wide as its column) */}
      <div className="flex flex-wrap gap-2 px-3 pt-2.5 pb-3 @sm:pl-15">
        {onSet ? <Button asChild size="sm"><a href={directionsUrl(where)} {...away}><Navigation /> Directions</a></Button> : null}
        <Button asChild size="sm" variant="outline"><a href={mapsUrl(where)} {...away}><ExternalLink /> Open in Maps</a></Button>
      </div>
    </section>
  );
}
