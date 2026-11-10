// What the assistant's set_place would write, on its confirm card: the task it goes on (named as the
// web app holds it), and the place itself as its card will show it. A place picked by its OpenStreetMap id is
// looked up here (the agent's places/place route, the same details set_place writes), so the owner sees the address and
// map before saying yes, never just an id; the place it replaces is named, and a clear says what goes.
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import type { WriteInput } from "@/core/agent";
import { WhereCard } from "@/components/where-card";
import { usePlaceTarget } from "@/hooks/place-target";
import { message } from "@/services/api";
import { place } from "@/services/places";

/** The place being set: OpenStreetMap's (looked up), or a name alone. */
function Proposed({ i }: { i: WriteInput }) {
  const id = i.place_id ?? "";
  const found = useQuery({ queryKey: ["place", id], queryFn: () => place(id), enabled: !!id, staleTime: Infinity, retry: false });
  if (!id) return <WhereCard where={{ name: i.name ?? "" }} />;
  if (found.data) return <WhereCard where={found.data} />;
  if (found.isPending) return <div className="h-32 animate-pulse rounded-2xl bg-muted" aria-label="Looking the place up" />;
  return (
    <p className="flex items-center gap-2 text-sm text-dim">
      <MapPin className="size-4 shrink-0" />
      A place from OpenStreetMap ({message(found.error)})
    </p>
  );
}

export function PlacePreview({ input }: { input: WriteInput }) {
  const { now } = usePlaceTarget(input);
  if (input.clear) return <p className="text-sm">{now ? <>No place any more: <span className="text-down line-through">{now.name}</span></> : "No place (it has none now)"}</p>;
  return (
    <div className="space-y-2">
      <Proposed i={input} />
      {now ? <p className="text-xs text-dim">Replaces <span className="line-through">{now.name}</span></p> : null}
    </div>
  );
}
