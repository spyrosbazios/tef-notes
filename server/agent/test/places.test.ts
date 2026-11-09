// Place search's pure parts: Google's answers as the core's shapes, the themed map request, and the routes' refusals
// before Google is asked (no key here: TEF_NOTES_KEYS_DIR points at an empty directory).
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { THEMES } from "@/core/theme";
import { fromGoogle, mapRoute, mapStyle, mapUrl, NO_KEY, placeRoute, suggestionsFrom, suggestRoute } from "../src/places";

const dir = mkdtempSync(join(tmpdir(), "places-")), was = process.env.TEF_NOTES_KEYS_DIR;
process.env.TEF_NOTES_KEYS_DIR = dir;
afterAll(() => { rmSync(dir, { recursive: true }); if (was === undefined) delete process.env.TEF_NOTES_KEYS_DIR; else process.env.TEF_NOTES_KEYS_DIR = was; });

describe("Google's answers", () => {
  it("a place as a note keeps it", () => {
    expect(fromGoogle({ id: "ChIJ8UNwBh-9oRQR3Y1mdkU1Nic", displayName: { text: "Acropolis Museum" }, formattedAddress: "Dionysiou Areopagitou 15, Athina 117 42, Greece", location: { latitude: 37.968450012, longitude: 23.7285 } }))
      .toEqual({ name: "Acropolis Museum", address: "Dionysiou Areopagitou 15, Athina 117 42, Greece", lat: 37.96845, lng: 23.7285, place_id: "ChIJ8UNwBh-9oRQR3Y1mdkU1Nic" });
    expect(fromGoogle({ id: "ChIJ8UNwBh-9oRQR3Y1mdkU1Nic" })).toBeNull();
  });
  it("suggestions: the name, and the rest of the line under it", () => {
    expect(suggestionsFrom({ suggestions: [
      { placePrediction: { placeId: "ChIJ8UNwBh-9oRQR", text: { text: "Acropolis Museum, Athens" }, structuredFormat: { mainText: { text: "Acropolis Museum" }, secondaryText: { text: "Athens, Greece" } } } },
      { placePrediction: { placeId: "ChIJ8UNwBh-9oRQS", text: { text: "Somewhere" } } },
      {},
    ] })).toEqual([
      { place_id: "ChIJ8UNwBh-9oRQR", name: "Acropolis Museum", detail: "Athens, Greece" },
      { place_id: "ChIJ8UNwBh-9oRQS", name: "Somewhere", detail: "" },
    ]);
    expect(suggestionsFrom(null)).toEqual([]);
  });
});

describe("the map", () => {
  it("is drawn at 2× in the theme's colours, the pin in the accent", () => {
    const u = new URL(mapUrl(37.97, 23.73, 320, 160, "light", "red", "K"));
    expect(u.searchParams.get("size")).toBe("320x160");
    expect(u.searchParams.get("scale")).toBe("2");
    expect(u.searchParams.get("markers")).toBe("color:0xc62828|37.97,23.73");
    expect(u.searchParams.getAll("style")).toEqual(mapStyle(THEMES.light.C));
    expect(u.searchParams.getAll("style")[0]).toBe(`element:geometry|color:0x${THEMES.light.C.card.slice(1)}`);
    expect(new URL(mapUrl(1, 2, 100, 100, "oled", "theme", "K")).searchParams.get("markers")).toBe(`color:0x${THEMES.oled.C.brand.slice(1)}|1,2`);
  });
});

describe("the routes", () => {
  const get = (path: string) => new Request(`http://agent/agent/${path}`);
  it("refuse a malformed request before anything else", async () => {
    expect((await suggestRoute(get("places/suggest?q="))).status).toBe(400);
    expect((await placeRoute(get("places/place?id=x"))).status).toBe(400);
    expect((await mapRoute(get("places/map?lat=91&lng=0&w=100&h=100"))).status).toBe(400);
    expect((await mapRoute(get("places/map?lat=1&lng=2&w=10&h=100"))).status).toBe(400);
  });
  it("say so without a key", async () => {
    for (const r of [await suggestRoute(get("places/suggest?q=cafe")), await placeRoute(get("places/place?id=ChIJ8UNwBh-9oRQR")), await mapRoute(get("places/map?lat=1&lng=2&w=100&h=100"))]) {
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ message: NO_KEY });
    }
  });
});
