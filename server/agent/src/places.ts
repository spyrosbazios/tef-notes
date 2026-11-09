// Place search for a note's `where` (contract: packages/core/src/places.ts), over Google Maps Platform with the `maps` key
// (keys.ts): Places API (New) Autocomplete as the owner types, Place Details for the one picked, Text Search for the
// assistant's find_place, and Maps Static for the place's picture, drawn in the app's theme. The key never leaves the
// server: the clients ask these routes, and the map comes back as an image.
//
//   GET /agent/places/suggest?q=&session=&lang=   200 Suggestions
//   GET /agent/places/place?id=&session=&lang=     200 Place
//   GET /agent/places/map?lat=&lng=&w=&h=&theme=&accent=   200 image/png
// 503 without a key, 400 a malformed request, 502 Google refused or didn't answer (its message, when it gave one).
import { getJson, HttpError } from "@/core/http";
import { MAP_MAX, placeOf, type Place, type Suggestion } from "@/core/places";
import { ACCENT_NAMES, accentColor, DEFAULT_THEME, THEME_NAMES, THEMES, type AccentName, type Palette, type ThemeName } from "@/core/theme";
import { key } from "./keys";

const PLACES = "https://places.googleapis.com/v1";
const STATIC = "https://maps.googleapis.com/maps/api/staticmap";
/** What a Place Details or Text Search answer is asked for: the Pro fields a note keeps, nothing billed beyond them. */
const FIELDS = ["id", "displayName", "formattedAddress", "location"];
export const FOUND = 5;                     // find_place: places handed back

export const NO_KEY = "Place search isn't set up on the notes server (no Google Maps key).";

/** A Google error as words: its own message when it sent one. */
export class PlacesError extends Error {}

async function google(url: string, init: RequestInit, fields: string[], signal?: AbortSignal): Promise<any> {
  const k = await key("maps");
  if (!k) throw new PlacesError(NO_KEY);
  try {
    return await getJson(url, {
      ...init, signal,
      headers: { "X-Goog-Api-Key": k, "X-Goog-FieldMask": fields.join(","), ...(init.body ? { "Content-Type": "application/json" } : {}) },
    }, 2, 10_000);
  } catch (e) {
    if (signal?.aborted) throw new PlacesError("Stopped.");
    const said = e instanceof HttpError ? (e.body as { error?: { message?: string } } | undefined)?.error?.message : undefined;
    throw new PlacesError(`Google Maps: ${said ?? (e as Error).message}`);
  }
}

const lang = (v: string | null | undefined) => (v && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(v) ? v : undefined);
const session = (v: string | null | undefined) => (v && /^[\w-]{8,64}$/.test(v) ? v : undefined);

type GPlace = { id?: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number } };
type GSuggestion = { placePrediction?: { placeId?: string; text?: { text?: string }; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } } } };

/** A Google place as a note keeps it; null without a name. */
export const fromGoogle = (g: GPlace): Place | null =>
  placeOf({ name: g.displayName?.text, address: g.formattedAddress, lat: g.location?.latitude, lng: g.location?.longitude, place_id: g.id });

/** Autocomplete's place predictions as suggestions: the name, and the rest of the line under it. */
export const suggestionsFrom = (r: { suggestions?: GSuggestion[] } | null): Suggestion[] =>
  (r?.suggestions ?? []).flatMap(({ placePrediction: p }) => {
    const name = p?.structuredFormat?.mainText?.text ?? p?.text?.text;
    return p?.placeId && name ? [{ place_id: p.placeId, name, detail: p.structuredFormat?.secondaryText?.text ?? "" }] : [];
  });

export async function suggest(input: string, o: { session?: string; lang?: string } = {}, signal?: AbortSignal): Promise<Suggestion[]> {
  const r = await google(`${PLACES}/places:autocomplete`, {
    method: "POST", body: JSON.stringify({ input, ...(o.session ? { sessionToken: o.session } : {}), ...(o.lang ? { languageCode: o.lang } : {}) }),
  }, ["suggestions.placePrediction.placeId", "suggestions.placePrediction.text", "suggestions.placePrediction.structuredFormat"], signal);
  return suggestionsFrom(r);
}

/** One place by its id. The picker's `session` ends with it (Google bills the session as one). */
export async function details(placeId: string, o: { session?: string; lang?: string } = {}, signal?: AbortSignal): Promise<Place> {
  if (!/^[\w-]{10,300}$/.test(placeId)) throw new PlacesError("Not a place id.");
  const q = new URLSearchParams({ ...(o.session ? { sessionToken: o.session } : {}), ...(o.lang ? { languageCode: o.lang } : {}) });
  const p = fromGoogle(await google(`${PLACES}/places/${placeId}${q.size ? `?${q}` : ""}`, { method: "GET" }, FIELDS, signal));
  if (!p) throw new PlacesError("Google Maps has no name for that place.");
  return p;
}

/** Places for a query in words ("the bakery on Ermou street, Athens"), best first. */
export async function search(query: string, o: { lang?: string } = {}, signal?: AbortSignal): Promise<Place[]> {
  const r = await google(`${PLACES}/places:searchText`, {
    method: "POST", body: JSON.stringify({ textQuery: query, pageSize: FOUND, ...(o.lang ? { languageCode: o.lang } : {}) }),
  }, FIELDS.map((f) => `places.${f}`), signal);
  return ((r?.places ?? []) as GPlace[]).flatMap((g) => fromGoogle(g) ?? []);
}

// ---- the map

/** `#rrggbb` as Static Maps writes a colour. */
const hex = (c: string) => `0x${c.slice(1)}`;
/** `a` moved toward `b` by `t` (0..1). */
function mix(a: string, b: string, t: number) {
  const ch = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const [x, y] = [ch(a), ch(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** The map's look from the app's palette: its ground, its lines for roads, the brand for water's tint and the pin;
 *  businesses' and transit's own pins off, so the one that matters is the note's. */
export function mapStyle(C: Palette): string[] {
  return [
    `element:geometry|color:${hex(C.card)}`,
    `element:labels.text.fill|color:${hex(C.dim)}`,
    `element:labels.text.stroke|color:${hex(C.card)}`,
    `element:labels.icon|visibility:off`,
    `feature:poi|visibility:off`,
    `feature:transit|visibility:off`,
    `feature:landscape.natural|element:geometry|color:${hex(mix(C.card, C.up, 0.1))}`,
    `feature:road|element:geometry|color:${hex(C.raised)}`,
    `feature:road|element:geometry.stroke|color:${hex(C.line)}`,
    `feature:road.highway|element:geometry|color:${hex(mix(C.raised, C.line, 0.6))}`,
    `feature:water|element:geometry|color:${hex(mix(C.card, C.brand, 0.22))}`,
    `feature:administrative|element:geometry.stroke|color:${hex(C.line)}`,
  ];
}

/** The Static Maps request for a place's picture: `w`×`h` CSS pixels at 2×, the pin in the accent. */
export function mapUrl(lat: number, lng: number, w: number, h: number, theme: ThemeName, accent: AccentName, k: string): string {
  const t = THEMES[theme], u = new URL(STATIC), at = `${lat},${lng}`;
  u.searchParams.set("center", at);
  u.searchParams.set("zoom", "15");
  u.searchParams.set("size", `${w}x${h}`);
  u.searchParams.set("scale", "2");
  u.searchParams.set("markers", `color:${hex(accentColor(t, accent))}|${at}`);
  for (const s of mapStyle(t.C)) u.searchParams.append("style", s);
  u.searchParams.set("key", k);
  return u.toString();
}

// ---- the routes

const fail = (status: number, message: string) => Response.json({ message }, { status });
const failed = (e: unknown) => fail((e as Error).message === NO_KEY ? 503 : e instanceof PlacesError ? 502 : 500, (e as Error).message);

export async function suggestRoute(req: Request): Promise<Response> {
  const p = new URL(req.url).searchParams, q = (p.get("q") ?? "").trim();
  if (!q || q.length > 200) return fail(400, "Type a place to look for.");
  try { return Response.json({ suggestions: await suggest(q, { session: session(p.get("session")), lang: lang(p.get("lang")) }, req.signal) }); }
  catch (e) { return failed(e); }
}

export async function placeRoute(req: Request): Promise<Response> {
  const p = new URL(req.url).searchParams;
  try { return Response.json(await details(p.get("id") ?? "", { session: session(p.get("session")), lang: lang(p.get("lang")) }, req.signal)); }
  catch (e) { return (e as Error).message === "Not a place id." ? fail(400, "Not a place id.") : failed(e); }
}

const num = (v: string | null, max: number) => {
  const n = v == null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
};
const side = (v: string | null) => { const n = num(v, MAP_MAX); return n != null && n >= 40 ? Math.round(n) : null; };

export async function mapRoute(req: Request): Promise<Response> {
  const p = new URL(req.url).searchParams;
  const lat = num(p.get("lat"), 90), lng = num(p.get("lng"), 180), w = side(p.get("w")), h = side(p.get("h"));
  if (lat == null || lng == null || w == null || h == null) return fail(400, `lat, lng, and w and h from 40 to ${MAP_MAX}.`);
  const theme = (THEME_NAMES as readonly string[]).includes(p.get("theme") ?? "") ? p.get("theme") as ThemeName : DEFAULT_THEME;
  const accent = (ACCENT_NAMES as readonly string[]).includes(p.get("accent") ?? "") ? p.get("accent") as AccentName : "theme";
  const k = await key("maps");
  if (!k) return fail(503, NO_KEY);
  let r: globalThis.Response;
  try { r = await fetch(mapUrl(lat, lng, w, h, theme, accent, k), { signal: AbortSignal.any([req.signal, AbortSignal.timeout(10_000)]) }); }
  catch { return fail(502, "Google Maps didn't answer."); }
  const type = r.headers.get("content-type") ?? "";
  if (!r.ok || !type.startsWith("image/")) return fail(502, `Google Maps: no map (HTTP ${r.status}).`);
  // The same place in the same look is the same picture: kept a week by the browser and its service worker
  return new Response(r.body, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=604800" } });
}
