// POST /agent/title, the model mocked: a share of files alone is titled from a PDF's first pages or by looking at a photo,
// and every failure answers no title, so the clip route keeps its own.
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { titleRoute } from "../src/title";
import type { model } from "../src/models";
import { fakePb } from "./fake-pb";
import { makePdf } from "./pdf";

const pb = fakePb();
afterAll(() => pb.stop());

type Reply = Awaited<ReturnType<MockLanguageModelV3["doGenerate"]>>;
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const says = (text: string): Reply => ({ content: [{ type: "text", text }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] });

let reply: () => Reply, prompts: string[] = [];
const mock = new MockLanguageModelV3({ doGenerate: async (o) => { prompts.push(JSON.stringify(o.prompt)); return reply(); } });
const pick = (async () => ({ model: mock, providerOptions: {} })) as unknown as typeof model;
const ask = async (note: string, p = pick) =>
  (await titleRoute(new Request("http://x/agent/title", { method: "POST", body: JSON.stringify({ note }) }), { url: pb.url }, p)).json();

beforeEach(() => { pb.attachments.clear(); prompts = []; reply = () => says("x"); });

describe("POST /agent/title", () => {
  it("titles a PDF from its first pages, cleaned", async () => {
    pb.attach("n1", "scan-0042.pdf", makePdf(["Lease agreement Athens flat", "Rent 900 a month"]));
    reply = () => says('"Lease agreement for the Athens flat."\n');
    expect(await ask("n1")).toEqual({ title: "Lease agreement for the Athens flat" });
    expect(prompts[0]).toContain("Lease agreement Athens flat");
  });

  it("titles a photo by looking at it", async () => {
    pb.attach("n2", "photo-1.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    reply = () => says("Title: Receipt from the hardware shop");
    expect(await ask("n2")).toEqual({ title: "Receipt from the hardware shop" });
    expect(prompts[0]).toContain("image/jpeg");
  });

  it("answers no title when the model fails, so the save keeps its own", async () => {
    pb.attach("n3", "photo-1.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    reply = () => { throw new Error("402 out of credit"); };
    expect(await ask("n3")).toEqual({ title: null });
  });

  it("answers no title without a key", async () => {
    pb.attach("n4", "photo-1.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    const none = (async () => { throw new Error("no API key"); }) as unknown as typeof model;
    expect(await ask("n4", none)).toEqual({ title: null });
  });

  it("asks no model when there is nothing to title it from", async () => {
    pb.attach("n5", "blank.pdf", makePdf([""]));
    expect(await ask("n5")).toEqual({ title: null });
    expect(await ask("nothing-here")).toEqual({ title: null });
    expect(prompts).toHaveLength(0);
  });
});
