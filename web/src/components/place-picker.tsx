// A note's Where, picked: Google Maps' suggestions as the owner types (services/places.ts), and always the words as typed,
// for a place Maps can't know ("Home"). Shown in a popover, a sheet at phone width (components/pick.tsx). One session
// token per opening ties the suggestions to the pick, which Google bills as one search; a server without a Maps key
// answers 503, and the picker keeps to the typed name.
import { AutoHeight } from "@animate-ui/react/primitives/effects/auto-height";
import { Highlight, HighlightItem } from "@animate-ui/react/primitives/effects/highlight";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Loader2, MapPin, PenLine, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { placeSession, type Place, type Suggestion } from "@/core/places";
import { Input } from "@/components/ui/input";
import { useHovers } from "@/hooks/hover";
import { cn } from "@/lib/utils";
import { message } from "@/services/api";
import { noSearch, place, suggest } from "@/services/places";

const WAIT = 250;          // ms after the last key before Google is asked

function Row({ icon: Icon, name, detail, active, onClick }: { icon: typeof MapPin; name: string; detail?: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} onMouseDown={(e) => e.preventDefault()} aria-selected={active} role="option"
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
  const [session] = useState(placeSession);
  const [typed, setTyped] = useState(start), [asked, setAsked] = useState(start.trim());
  const [at, setAt] = useState(0), [busy, setBusy] = useState(false);
  const hovers = useHovers();
  useEffect(() => {
    const t = setTimeout(() => setAsked(typed.trim()), WAIT);
    return () => clearTimeout(t);
  }, [typed]);
  const found = useQuery({
    queryKey: ["places", session, asked], queryFn: ({ signal }) => suggest(asked, session, signal),
    enabled: asked.length >= 2, placeholderData: keepPreviousData, staleTime: 5 * 60_000, retry: false,
  });
  const off = noSearch(found.error);
  const list: Suggestion[] = asked.length >= 2 ? (found.data ?? []) : [];
  const name = typed.trim();
  // The rows in order: Google's suggestions, then the typed words as a name
  const rows = [...list.map((s) => ({ key: s.place_id, s })), ...(name ? [{ key: "typed", s: null }] : [])];
  const active = Math.min(at, rows.length - 1);

  const choose = async (s: Suggestion | null) => {
    if (!s) { if (name) onPick({ name }); return; }
    setBusy(true);
    try { onPick(await place(s.place_id, session)); } catch (e) { toast.error(message(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2" role="combobox" aria-expanded={rows.length > 0}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" />
        <Input value={typed} onChange={(e) => { setTyped(e.target.value); setAt(0); }} placeholder={off ? "Name the place" : "Search Google Maps"} aria-label="Place"
          autoFocus={!matchMedia("(pointer: coarse)").matches} enterKeyHint="search" className="pl-8"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(i + 1, rows.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter" && rows.length) { e.preventDefault(); void choose(rows[active].s); }
          }} />
        {busy || found.isFetching ? <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-faint" /> : null}
      </div>
      <AutoHeight>
        <div role="listbox" aria-label="Places" className="space-y-0.5">
          <Highlight controlledItems hover={hovers} className="inset-0 rounded-md bg-muted">
            {rows.map((r, i) => (
              <HighlightItem key={r.key} value={r.key}>
                {r.s ? <Row icon={MapPin} name={r.s.name} detail={r.s.detail} active={i === active} onClick={() => void choose(r.s)} />
                  : <Row icon={PenLine} name={`“${name}”`} detail="Just the name, no map" active={i === active} onClick={() => void choose(null)} />}
              </HighlightItem>
            ))}
          </Highlight>
          {found.error && !off ? <p className="px-2 py-1 text-xs text-down">{message(found.error)}</p> : null}
          {off ? <p className="px-2 py-1 text-xs text-faint">Place search isn't set up on the server: the place is kept by its name.</p> : null}
          {!name ? <p className="px-2 py-1 text-xs text-faint">A café, an address, a landmark…</p> : null}
        </div>
      </AutoHeight>
      {/* Google's terms: suggestions shown without a map carry its name */}
      {list.length ? <p className="px-2 text-right text-[10px] text-faint">Suggestions by Google</p> : null}
    </div>
  );
}
