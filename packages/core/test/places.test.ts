import { describe, expect, it } from "bun:test";
import { directionsUrl, mapPath, mapsUrl, placeOf, suggestionsOf } from "../src/places";

describe("placeOf", () => {
  it("keeps what is well formed", () => {
    expect(placeOf({ name: "  A  place ", address: "Street 1", lat: 37.98381234567, lng: 23.7275, place_id: "ChIJ8UNwBh-9oRQR3Y1mdkU1Nic" }))
      .toEqual({ name: "A place", address: "Street 1", lat: 37.9838123, lng: 23.7275, place_id: "ChIJ8UNwBh-9oRQR3Y1mdkU1Nic" });
    expect(placeOf({ name: "X", lat: 91, lng: 0, place_id: "bad id!" })).toEqual({ name: "X" });
    expect(placeOf({ name: "X", lat: 1 })).toEqual({ name: "X" });
    expect(placeOf({ name: "X", address: "X" })).toEqual({ name: "X" });
    expect(placeOf({ address: "only" })).toBeNull();
    expect(placeOf("Home")).toBeNull();
  });
});

describe("suggestionsOf", () => {
  it("drops malformed rows", () => {
    expect(suggestionsOf({ suggestions: [{ place_id: "ChIJ8UNwBh-9oRQR", name: "Acropolis", detail: "Athens" }, { name: "no id" }, null] }))
      .toEqual([{ place_id: "ChIJ8UNwBh-9oRQR", name: "Acropolis", detail: "Athens" }]);
    expect(suggestionsOf(null)).toEqual([]);
  });
});

describe("Maps links", () => {
  const p = { name: "Acropolis Museum", address: "Dionysiou Areopagitou 15, Athina 117 42", lat: 37.9684, lng: 23.7285, place_id: "ChIJ8UNwBh-9oRQR3Y1mdkU1Nic" };
  it("lands on the place by its id, name and address the fallback", () => {
    const u = new URL(mapsUrl(p));
    expect(u.origin + u.pathname).toBe("https://www.google.com/maps/search/");
    expect(u.searchParams.get("api")).toBe("1");
    expect(u.searchParams.get("query")).toBe("Acropolis Museum, Dionysiou Areopagitou 15, Athina 117 42");
    expect(u.searchParams.get("query_place_id")).toBe(p.place_id);
  });
  it("directions go to the coordinates and the id", () => {
    const u = new URL(directionsUrl(p));
    expect(u.pathname).toBe("/maps/dir/");
    expect(u.searchParams.get("destination")).toBe("37.9684,23.7285");
    expect(u.searchParams.get("destination_place_id")).toBe(p.place_id);
  });
  it("a name alone is searched for; bare coordinates are the query", () => {
    expect(new URL(directionsUrl({ name: "Home" })).searchParams.get("destination")).toBe("Home");
    expect(new URL(mapsUrl({ name: "Pin", lat: 1, lng: 2 })).searchParams.get("query")).toBe("1,2");
  });
  it("the map route carries what it draws", () => {
    expect(mapPath(p, 320.4, 160, "dark", "red")).toBe("places/map?lat=37.9684&lng=23.7285&w=320&h=160&theme=dark&accent=red");
  });
});
