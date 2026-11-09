// Place search for a note's Where, over the agent's routes (contract: core/places.ts): the server asks OpenStreetMap, so
// suggestions, a place by its id and its map all come from there.
import { mapPath, placeOf, placePath, suggestionsOf, suggestPath, type Place, type Suggestion } from "@/core/places";
import { api } from "./api";

const agent = { baseURL: "", timeout: 15_000 } as const;
const lang = () => navigator.language || undefined;

export async function suggest(input: string, signal?: AbortSignal): Promise<Suggestion[]> {
  return suggestionsOf((await api.get(`/agent/${suggestPath(input, lang())}`, { ...agent, signal })).data);
}

/** A place by its OpenStreetMap id, whole: its address and coordinates. */
export async function place(placeId: string): Promise<Place> {
  const p = placeOf((await api.get(`/agent/${placePath(placeId, lang())}`, agent)).data);
  if (!p) throw new Error("OpenStreetMap sent no place.");
  return p;
}

/** The address of the place's map picture; null for a place with no coordinates. */
export const mapSrc = (p: Place, w: number, h: number, theme: string, accent: string) =>
  p.lat != null && p.lng != null ? `/agent/${mapPath(p, w, h, theme, accent)}` : null;
