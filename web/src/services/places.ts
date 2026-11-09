// Place search for a note's Where, over the agent's routes (contract: core/places.ts): the server holds the Google Maps key,
// so suggestions, the picked place and its map all come from there.
import { AxiosError } from "axios";
import { mapPath, placeOf, placePath, suggestionsOf, suggestPath, type Place, type Suggestion } from "@/core/places";
import { api } from "./api";

const agent = { baseURL: "", timeout: 15_000 } as const;
const lang = () => navigator.language || undefined;

/** The server has no Google Maps key: a place can only be typed by name. */
export const noSearch = (e: unknown) => e instanceof AxiosError && e.response?.status === 503;

export async function suggest(input: string, session: string, signal?: AbortSignal): Promise<Suggestion[]> {
  return suggestionsOf((await api.get(`/agent/${suggestPath(input, session, lang())}`, { ...agent, signal })).data);
}

/** The place a suggestion stands for, whole: its address and coordinates. */
export async function place(placeId: string, session: string): Promise<Place> {
  const p = placeOf((await api.get(`/agent/${placePath(placeId, session, lang())}`, agent)).data);
  if (!p) throw new Error("Google Maps sent no place.");
  return p;
}

/** The address of the place's map picture; null for a place with no coordinates. */
export const mapSrc = (p: Place, w: number, h: number, theme: string, accent: string) =>
  p.lat != null && p.lng != null ? `/agent/${mapPath(p, w, h, theme, accent)}` : null;
