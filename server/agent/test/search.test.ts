// GET /agent/search: words and meaning fused, as the chat's search_notes (the embedding model faked, test/embed.ts).
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { searchHitsOf } from "@/core/find";
import { search } from "../src/search";
import "./embed";                                   // the fake model, also when run from server/ (no bunfig preload there)
import { fakePb } from "./fake-pb";

const pb = fakePb();
afterAll(() => pb.stop());
const get = (qs: string) => search(new Request(`http://x/agent/search?${qs}`), { url: pb.url });

beforeEach(() => {
  pb.notes.clear();
  pb.put("notes/20261001-toyota.md", "---\ntitle: Toyota service\ncreated: 2026-10-01\n---\nOil changed.\n");
  pb.put("notes/20261002-dentist.md", "---\ntitle: Dentist\ncreated: 2026-10-02\n---\nTuesday at 10.\n");
});

describe("GET /agent/search", () => {
  it("finds a note by its meaning", async () => {
    const hits = searchHitsOf(await (await get("q=car")).json());
    expect(hits[0]).toMatchObject({ path: "notes/20261001-toyota.md", match: "meaning" });
  });
  it("finds a note by its words", async () => {
    const hits = searchHitsOf(await (await get("q=oil")).json());
    expect(hits.map((h) => h.path)).toEqual(["notes/20261001-toyota.md"]);
  });
  it("refuses no query or a limit out of range", async () => {
    expect((await get("q=")).status).toBe(400);
    expect((await get("q=car&limit=99")).status).toBe(400);
  });
});
