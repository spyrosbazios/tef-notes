// Place search for a note's `where` (contract: packages/core/src/places.ts), over OpenStreetMap's free services, no key:
// Photon (komoot's OSM geocoder, made for search as you type) for the picker's suggestions and the assistant's find_place,
// Nominatim for one place by its OSM id (set_place, the confirm card), and OSM's standard tiles for the place's picture,
// drawn here as an SVG in the app's theme. Their usage policies ask for an identifying User-Agent, light use and the
// tiles credited; the tiles are cached in memory, the picture by the browser.
//
//   GET /agent/places/suggest?q=&lang=                   200 Suggestions (each a whole place: no second request)
//   GET /agent/places/place?id=&lang=                     200 Place (`id`: N123, W123 or R123)
//   GET /agent/places/map?lat=&lng=&w=&h=&theme=&accent=  200 image/svg+xml
// 400 a malformed request, 502 the service refused or didn't answer.
import { getJson } from "@/core/http";
import { MAP_MAX, OSM_ID, placeOf, type Place, type Suggestion } from "@/core/places";
import { ACCENT_NAMES, accentColor, DEFAULT_THEME, THEME_NAMES, THEMES, type AccentName, type Palette, type ThemeName } from "@/core/theme";

const PHOTON = "https://photon.komoot.io/api/";
const NOMINATIM = "https://nominatim.openstreetmap.org/lookup";
const TILES = "https://tile.openstreetmap.org";
const AGENT = { "User-Agent": "tef-notes (self-hosted notes; https://github.com/spyrosbazios/tef-notes)" };
export const FOUND = 5;                     // find_place: places handed back
const SUGGESTED = 6;                        // the picker's rows

export class PlacesError extends Error {}

async function ask(url: URL, what: string, signal?: AbortSignal): Promise<any> {
  try { return await getJson(url.toString(), { signal, headers: AGENT }, 2, 10_000); }
  catch (e) {
    if (signal?.aborted) throw new PlacesError("Stopped.");
    throw new PlacesError(`${what}: ${(e as Error).message}`);
  }
}

/** Photon speaks only these; anything else gets the names as the map has them (local). */
const photonLang = (v: string | null | undefined) => { const l = v?.slice(0, 2).toLowerCase(); return l && ["en", "de", "fr"].includes(l) ? l : undefined; };
const lang = (v: string | null | undefined) => (v && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(v) ? v : undefined);

const join = (...parts: (string | undefined)[]) => parts.map((s) => s?.trim()).filter(Boolean).join(", ");
const line = (a?: string, b?: string) => [a, b].map((s) => s?.trim()).filter(Boolean).join(" ");

type PhotonProps = { osm_type?: string; osm_id?: number; name?: string; housenumber?: string; street?: string; locality?: string; district?: string; city?: string; postcode?: string; country?: string };
type PhotonFeature = { properties?: PhotonProps; geometry?: { coordinates?: [number, number] } };

/** A Photon hit as a place: its name (or its street and number, for an address), its address, its point, its OSM id. */
export function fromPhoton(f: PhotonFeature): Place | null {
  const p = f.properties ?? {}, [lng, lat] = f.geometry?.coordinates ?? [];
  const street = line(p.street, p.housenumber), name = p.name ?? (street || p.city);
  const address = join(street, line(p.postcode, p.city ?? p.district ?? p.locality), p.country);
  return placeOf({ name, address, lat, lng, place_id: p.osm_type && p.osm_id ? `${p.osm_type}${p.osm_id}` : undefined });
}

/** Photon's answer as places, best first, each once. */
export const placesFrom = (r: { features?: PhotonFeature[] } | null): Place[] => {
  const seen = new Set<string>();
  return (r?.features ?? []).flatMap((f) => {
    const p = fromPhoton(f), k = p && (p.place_id ?? `${p.name}|${p.address}`);
    if (!p || seen.has(k!)) return [];
    seen.add(k!);
    return [p];
  });
};

async function photon(q: string, limit: number, l: string | undefined, signal?: AbortSignal): Promise<Place[]> {
  const u = new URL(PHOTON);
  u.searchParams.set("q", q);
  u.searchParams.set("limit", String(limit));
  const pl = photonLang(l);
  if (pl) u.searchParams.set("lang", pl);
  return placesFrom(await ask(u, "OpenStreetMap search", signal));
}

export async function suggest(input: string, o: { lang?: string } = {}, signal?: AbortSignal): Promise<Suggestion[]> {
  return (await photon(input, SUGGESTED, o.lang, signal)).map((p) => ({ ...p, detail: p.address ?? "" }));
}

/** Places for a query in words ("the bakery on Aiolou, Athens"), best first. */
export const search = (query: string, o: { lang?: string } = {}, signal?: AbortSignal) => photon(query, FOUND, o.lang, signal);

type NominatimHit = { osm_type?: string; osm_id?: number; lat?: string; lon?: string; name?: string; display_name?: string;
  address?: { road?: string; pedestrian?: string; house_number?: string; postcode?: string; city?: string; town?: string; village?: string; suburb?: string; country?: string } };

export function fromNominatim(h: NominatimHit): Place | null {
  const a = h.address ?? {}, street = line(a.road ?? a.pedestrian, a.house_number);
  const address = join(street, line(a.postcode, a.city ?? a.town ?? a.village ?? a.suburb), a.country) || h.display_name;
  const name = h.name || street || h.display_name?.split(",")[0];
  const type = { node: "N", way: "W", relation: "R" }[h.osm_type ?? ""];
  return placeOf({ name, address, lat: Number(h.lat), lng: Number(h.lon), place_id: type && h.osm_id ? `${type}${h.osm_id}` : undefined });
}

/** One place by its OSM id (`N123`, a node; `W123`, a way; `R123`, a relation). */
export async function details(placeId: string, o: { lang?: string } = {}, signal?: AbortSignal): Promise<Place> {
  if (!OSM_ID.test(placeId)) throw new PlacesError("Not a place id.");
  const u = new URL(NOMINATIM);
  u.searchParams.set("osm_ids", placeId);
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("addressdetails", "1");
  if (o.lang) u.searchParams.set("accept-language", o.lang);
  const p = fromNominatim(((await ask(u, "OpenStreetMap", signal)) ?? [])[0] ?? {});
  if (!p) throw new PlacesError("OpenStreetMap has no place by that id.");
  return p;
}

// ---- the map

/** Tiles at zoom 16 drawn at half size: a street-level picture, sharp on a 2× screen. */
const ZOOM = 16, TILE = 256, SCALE = 2;
const tiles = new Map<string, string>();     // "z/x/y" -> the PNG as a data URL, oldest first
const TILES_KEPT = 400;

async function tile(x: number, y: number, signal: AbortSignal): Promise<string | null> {
  const k = `${ZOOM}/${x}/${y}`, had = tiles.get(k);
  if (had) { tiles.delete(k); tiles.set(k, had); return had; }
  try {
    const r = await fetch(`${TILES}/${k}.png`, { headers: AGENT, signal });
    if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("image/")) return null;
    const url = `data:image/png;base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
    tiles.set(k, url);
    if (tiles.size > TILES_KEPT) tiles.delete(tiles.keys().next().value!);
    return url;
  } catch { return null; }
}

/** Where a point falls on the world at ZOOM, in tile pixels (Web Mercator). */
export function worldPx(lat: number, lng: number) {
  const n = TILE * 2 ** ZOOM, s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

/** The tiles a `w`×`h` picture centred on a point needs, each with where it goes in the picture (in tile pixels). */
export function tilesFor(lat: number, lng: number, w: number, h: number) {
  const c = worldPx(lat, lng), W = w * SCALE, H = h * SCALE, left = c.x - W / 2, top = c.y - H / 2, last = 2 ** ZOOM - 1;
  const out: { x: number; y: number; dx: number; dy: number }[] = [];
  for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + H) / TILE); ty++) {
    if (ty < 0 || ty > last) continue;
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + W) / TILE); tx++)
      out.push({ x: ((tx % (last + 1)) + last + 1) % (last + 1), y: ty, dx: tx * TILE - left, dy: ty * TILE - top });
  }
  return out;
}

const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
const mixed = (a: string, b: string, t: number) => rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t);

/** The theme as a duotone: the map's dark lines in the theme's dim ink, its light ground in the card's colour (a dark
 *  theme's map comes out dark), the steps between through a middle tone. */
export function duotone(C: Palette) {
  const stops = [rgb(C.dim), mixed(C.dim, C.card, 0.7), rgb(C.card)];
  return [0, 1, 2].map((ch) => stops.map((s) => s[ch].toFixed(3)).join(" "));
}

export function mapSvg(w: number, h: number, parts: { href: string; dx: number; dy: number }[], theme: ThemeName, accent: AccentName): string {
  const t = THEMES[theme], [r, g, b] = duotone(t.C), pin = accentColor(t, accent), W = w * SCALE, H = h * SCALE;
  const images = parts.map((p) => `<image href="${p.href}" x="${p.dx.toFixed(1)}" y="${p.dy.toFixed(1)}" width="${TILE}" height="${TILE}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${W} ${H}">`
    + `<filter id="t" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/><feComponentTransfer>`
    + `<feFuncR type="table" tableValues="${r}"/><feFuncG type="table" tableValues="${g}"/><feFuncB type="table" tableValues="${b}"/></feComponentTransfer></filter>`
    + `<rect width="100%" height="100%" fill="${t.C.card}"/><g filter="url(#t)">${images}</g>`
    + `<circle cx="${W / 2}" cy="${H / 2}" r="22" fill="${pin}" fill-opacity="0.2"/><circle cx="${W / 2}" cy="${H / 2}" r="11" fill="${pin}" stroke="${t.C.card}" stroke-width="4"/>`
    + `<text x="${W - 10}" y="${H - 10}" text-anchor="end" font-family="system-ui,sans-serif" font-size="18" fill="${t.C.dim}">© OpenStreetMap</text></svg>`;
}

// ---- the routes

const fail = (status: number, message: string) => Response.json({ message }, { status });
const failed = (e: unknown) => fail(e instanceof PlacesError ? 502 : 500, (e as Error).message);

export async function suggestRoute(req: Request): Promise<Response> {
  const p = new URL(req.url).searchParams, q = (p.get("q") ?? "").trim();
  if (!q || q.length > 200) return fail(400, "Type a place to look for.");
  try { return Response.json({ suggestions: await suggest(q, { lang: lang(p.get("lang")) }, req.signal) }); }
  catch (e) { return failed(e); }
}

export async function placeRoute(req: Request): Promise<Response> {
  const p = new URL(req.url).searchParams, id = p.get("id") ?? "";
  if (!OSM_ID.test(id)) return fail(400, "Not a place id.");
  try { return Response.json(await details(id, { lang: lang(p.get("lang")) }, req.signal)); }
  catch (e) { return failed(e); }
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
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(15_000)]), want = tilesFor(lat, lng, w, h), parts = [];
  // Four at a time, gently on OSM's tile servers
  for (let i = 0; i < want.length; i += 4)
    for (const [j, href] of (await Promise.all(want.slice(i, i + 4).map((t) => tile(t.x, t.y, signal)))).entries())
      if (href) parts.push({ href, ...want[i + j] });
  if (!parts.length) return fail(502, "OpenStreetMap sent no map.");
  // The same place in the same look is the same picture: kept a week by the browser and its service worker
  return new Response(mapSvg(w, h, parts, theme, accent), { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, max-age=604800" } });
}
