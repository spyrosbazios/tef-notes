// A note's Where, picked: OpenStreetMap's suggestions as the owner types (services/places.ts), each a whole place, and
// always the words as typed, for a place a map can't know ("Home"). Shown in a popover, a sheet at phone width
// (components/pick.tsx).
import { AutoHeight } from "@animate-ui/react/primitives/effects/auto-height";
import { Highlight, HighlightItem } from "@animate-ui/react/primitives/effects/highlight";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Loader2, MapPin, PenLine, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { placeOf, type Place, type PlaceSuggestion } from "@/core/places";
import { Input } from "@/components/ui/input";
import { useHovers } from "@/hooks/hover";
import { answered, MIN_QUERY } from "@/lib/place-query";
import { cn } from "@/lib/utils";
import { message } from "@/services/api";
import { suggest } from "@/services/places";

const WAIT = 300;          // ms after the last key before OpenStreetMap is asked

function Row({ icon: Icon, name, detail, active, ...props }: React.ComponentProps<"button"> & { icon: typeof MapPin; name: string; detail?: string; active: boolean }) {
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} aria-selected={active} role="option" {...props}
      className={cn("flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors any-pointer-coarse:py-2.5", active && "bg-muted")}>
      <Icon className="mt-0.5 size-4 shrink-0 text-dim" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{name}</span>
        {detail ? <span className="block truncate text-xs text-faint">{detail}</span> : null}
      </span>
    </button>
  );
}

export function PlacePicker({ start = "", onPick }: { start?: string; onPick: (p: Place) => void }) {
  const [typed, setTyped] = useState(start), [asked, setAsked] = useState(start.trim());
  const [at, setAt] = useState(0);
  // Enter pressed before the suggestions for the typed words are in: the pick waits for them
  const [submit, setSubmit] = useState(false);
  const hovers = useHovers();
  useEffect(() => {
    const t = setTimeout(() => setAsked(typed.trim()), WAIT);
    return () => clearTimeout(t);
  }, [typed]);
  const found = useQuery({
    queryKey: ["places", asked], queryFn: ({ signal }) => suggest(asked, signal),
    enabled: asked.length >= MIN_QUERY, placeholderData: keepPreviousData, staleTime: 5 * 60_000, retry: false,
  });
  const list: PlaceSuggestion[] = asked.length >= MIN_QUERY ? (found.data ?? []) : [];
  const name = typed.trim();
  // The rows in order: the map's suggestions, then the typed words as a name
  const rows = [...list.map((s, i) => ({ key: s.place_id ?? `${i}`, s })), ...(name ? [{ key: "typed", s: null }] : [])];
  const active = Math.min(at, rows.length - 1);
  const settled = answered(name, asked, found);

  const choose = (s: PlaceSuggestion | null) => {
    const p = s && placeOf(s);
    if (p) onPick(p);
    else if (name) onPick({ name });
  };
  useEffect(() => {
    if (submit && settled) { setSubmit(false); choose(rows[active].s); }
  });

  return (
    <div className="space-y-2" role="combobox" aria-expanded={rows.length > 0}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" />
        <Input value={typed} onChange={(e) => { setTyped(e.target.value); setAt(0); setSubmit(false); }} placeholder="Search a place" aria-label="Place"
          autoFocus={!matchMedia("(pointer: coarse)").matches} enterKeyHint="search" className="pl-8"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(i + 1, rows.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter" && name) {
              e.preventDefault();
              if (settled) choose(rows[active].s);
              else { setAsked(name); setSubmit(true); }
            }
          }} />
        {found.isFetching ? <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-faint" /> : null}
      </div>
      <AutoHeight>
        <div role="listbox" aria-label="Places" className="space-y-0.5">
          <Highlight controlledItems hover={hovers} className="inset-0 rounded-md bg-muted">
            {rows.map((r, i) => (
              <HighlightItem key={r.key} value={r.key}>
                {r.s ? <Row icon={MapPin} name={r.s.name} detail={r.s.detail} active={i === active} onClick={() => choose(r.s)} />
                  : <Row icon={PenLine} name={`“${name}”`} detail="Just the name, no map" active={i === active} onClick={() => choose(null)} />}
              </HighlightItem>
            ))}
          </Highlight>
          {found.error ? <p className="px-2 py-1 text-xs text-down">{message(found.error)}</p> : null}
          {!name ? <p className="px-2 py-1 text-xs text-faint">A café, an address, a landmark…</p> : null}
        </div>
      </AutoHeight>
      {/* OpenStreetMap's licence: its data credited where it is shown */}
      {list.length ? <p className="px-2 text-right text-[10px] text-faint">© OpenStreetMap contributors</p> : null}
    </div>
  );
}
