// A note's place (its frontmatter's `where:` block, notes.ts) and the place search behind it. The agent holds the Google
// Maps Platform key (`maps`) and answers the clients' routes (server/agent/src/places.ts): `places/suggest` as the owner
// types (Autocomplete), `places/place` for the one they pick (Place Details), `places/map` for its picture (Maps Static,
// in the app's theme). One session token ties a picker's suggestions to its pick, which Google bills as one search.
// Directions and "open in Maps" are plain Google Maps URLs: no key, and on a phone they open the Maps app.

/** Where a note is about. `name` is all a hand-written `where: Home` has; a picked place also has its address, its
 *  coordinates and Google's id for it (`place_id`), which make the Maps links land on the place itself. */
export type Place = { name: string; address?: string; lat?: number; lng?: number; place_id?: string };

/** One suggestion while typing: the place's id, its name, and the rest of its description (the address, the town). */
export type Suggestion = { place_id: string; name: string; detail: string };

/** The answer of `places/suggest`. */
export type Suggestions = { suggestions: Suggestion[] };

/** The longest a name or an address may be in a note: a frontmatter line, not a paragraph. */
const MAX = 200;

const text = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX) : "");
const coord = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max ? Math.round(v * 1e7) / 1e7 : undefined);
const id = (v: unknown) => (typeof v === "string" && /^[\w-]{10,300}$/.test(v) ? v : undefined);

/** `x` as a Place, only what is well formed: null without a name. Coordinates count only as a pair. */
export function placeOf(x: unknown): Place | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>, name = text(o.name);
  if (!name) return null;
  const address = text(o.address), lat = coord(o.lat, 90), lng = coord(o.lng, 180), place_id = id(o.place_id);
  return {
    name, ...(address && address !== name ? { address } : {}), ...(lat != null && lng != null ? { lat, lng } : {}),
    ...(place_id ? { place_id } : {}),
  };
}

/** The suggest route's answer, defensively: malformed rows dropped. */
export function suggestionsOf(x: unknown): Suggestion[] {
  const list = x && typeof x === "object" ? (x as Record<string, unknown>).suggestions : null;
  if (!Array.isArray(list)) return [];
  return list.flatMap((s) => {
    const o = (s ?? {}) as Record<string, unknown>, place_id = id(o.place_id), name = text(o.name);
    return place_id && name ? [{ place_id, name, detail: text(o.detail) }] : [];
  });
}

/** What Maps searches for: the name and address, or the coordinates when there is no address. */
function query(p: Place) {
  if (p.address) return p.address.toLowerCase().includes(p.name.toLowerCase()) ? p.address : `${p.name}, ${p.address}`;
  return p.lat != null && p.lng != null && !p.place_id ? `${p.lat},${p.lng}` : p.name;
}

/** Google Maps on the place (developers.google.com/maps/documentation/urls). With an id it lands on the place itself,
 *  the query only a fallback. */
export function mapsUrl(p: Place): string {
  const u = new URL("https://www.google.com/maps/search/");
  u.searchParams.set("api", "1");
  u.searchParams.set("query", query(p));
  if (p.place_id) u.searchParams.set("query_place_id", p.place_id);
  return u.toString();
}

/** Directions to the place from wherever the owner is; Maps picks the travel mode they use. */
export function directionsUrl(p: Place): string {
  const u = new URL("https://www.google.com/maps/dir/");
  u.searchParams.set("api", "1");
  u.searchParams.set("destination", p.lat != null && p.lng != null ? `${p.lat},${p.lng}` : query(p));
  if (p.place_id) u.searchParams.set("destination_place_id", p.place_id);
  return u.toString();
}

/** A new token for one picker: its suggestions and the pick that ends them. */
export const placeSession = () => crypto.randomUUID();

const q = (o: Record<string, string | number | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") u.set(k, String(v));
  return u.toString();
};

/** The routes under the agent's `/agent/`. `lang`: the language names come back in (BCP-47). */
export const suggestPath = (input: string, session: string, lang?: string) => `places/suggest?${q({ q: input, session, lang })}`;
export const placePath = (placeId: string, session: string, lang?: string) => `places/place?${q({ id: placeId, session, lang })}`;
/** The place's map, `w`×`h` CSS pixels (drawn at twice that), in the theme and accent the app has on (theme.ts names).
 *  Only for a place with coordinates. */
export const mapPath = (p: Place, w: number, h: number, theme: string, accent: string) =>
  `places/map?${q({ lat: p.lat, lng: p.lng, w: Math.round(w), h: Math.round(h), theme, accent })}`;

/** What Static Maps draws at most, per side, before its 2× scale. */
export const MAP_MAX = 640;
