// Place search's pure parts: OpenStreetMap's answers as the core's shapes, the tiles a map needs, the themed picture,
// and the routes' refusals before anything is asked.
import { describe, expect, it } from "bun:test";
import { THEMES } from "@/core/theme";
import { duotone, fromNominatim, fromPhoton, mapRoute, mapSvg, placeRoute, placesFrom, suggestRoute, tilesFor, worldPx } from "../src/places";

const LUKUMADES = { properties: { osm_type: "N", osm_id: 9675835944, name: "LUKUΜΑΔΕΣ", housenumber: "21", street: "Αιόλου", locality: "Plaka", city: "Athens", postcode: "105 56", country: "Greece" }, geometry: { coordinates: [23.7275759, 37.9769476] as [number, number] } };

describe("Photon's answers", () => {
  it("a place as a note keeps it", () => {
    expect(fromPhoton(LUKUMADES)).toEqual({ name: "LUKUΜΑΔΕΣ", address: "Αιόλου 21, 105 56 Athens, Greece", lat: 37.9769476, lng: 23.7275759, place_id: "N9675835944" });
  });
  it("an address without a name is named by its street", () => {
    expect(fromPhoton({ properties: { osm_type: "W", osm_id: 12, street: "Ermou", housenumber: "5", city: "Athens" }, geometry: { coordinates: [23.73, 37.97] } }))
      .toMatchObject({ name: "Ermou 5", address: "Ermou 5, Athens", place_id: "W12" });
  });
  it("drops nameless hits and repeats", () => {
    expect(placesFrom({ features: [LUKUMADES, LUKUMADES, { properties: {} }] })).toHaveLength(1);
    expect(placesFrom(null)).toEqual([]);
  });
});

describe("Nominatim's answer", () => {
  it("a place by its id", () => {
    expect(fromNominatim({ osm_type: "node", osm_id: 9675835944, lat: "37.9769476", lon: "23.7275759", name: "LUKUΜΑΔΕΣ", display_name: "LUKUΜΑΔΕΣ, 21, Αιόλου, Athens", address: { road: "Αιόλου", house_number: "21", postcode: "105 56", city: "Athens", country: "Greece" } }))
      .toEqual({ name: "LUKUΜΑΔΕΣ", address: "Αιόλου 21, 105 56 Athens, Greece", lat: 37.9769476, lng: 23.7275759, place_id: "N9675835944" });
    expect(fromNominatim({})).toBeNull();
  });
});

describe("the map", () => {
  it("centres the point and covers the picture with tiles", () => {
    const c = worldPx(37.9769476, 23.7275759), ts = tilesFor(37.9769476, 23.7275759, 320, 160);
    expect(Math.floor(c.x / 256)).toBe(37087);
    for (const t of ts) expect(t.dx).toBeGreaterThan(-256);
    const xs = new Set(ts.map((t) => t.x)), ys = new Set(ts.map((t) => t.y));
    expect(xs.size * 256).toBeGreaterThanOrEqual(640);
    expect(ys.size * 256).toBeGreaterThanOrEqual(320);
  });
  it("is the theme's duotone, the pin in the accent, OSM credited", () => {
    expect(duotone(THEMES.light.C)[0].split(" ")).toHaveLength(3);
    const svg = mapSvg(320, 160, [{ href: "data:image/png;base64,AA", dx: 0, dy: 0 }], "light", "red");
    expect(svg).toContain('fill="#c62828"');
    expect(svg).toContain("© OpenStreetMap");
    expect(svg).toContain(`fill="${THEMES.light.C.card}"`);
  });
});

describe("the routes", () => {
  const get = (path: string) => new Request(`http://agent/agent/${path}`);
  it("refuse a malformed request before anything else", async () => {
    expect((await suggestRoute(get("places/suggest?q="))).status).toBe(400);
    expect((await placeRoute(get("places/place?id=ChIJ8UNwBh-9oRQR"))).status).toBe(400);
    expect((await mapRoute(get("places/map?lat=91&lng=0&w=100&h=100"))).status).toBe(400);
    expect((await mapRoute(get("places/map?lat=1&lng=2&w=10&h=100"))).status).toBe(400);
  });
});
