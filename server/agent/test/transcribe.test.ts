import { afterAll, beforeAll, expect, test } from "bun:test";
import { transcribe, warmSpeech as warm } from "../src/transcribe";

let fake: ReturnType<typeof Bun.serve>;
const seen: string[] = [];
beforeAll(() => {
  fake = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const u = new URL(req.url);
      seen.push(`${u.pathname}?${u.searchParams}`);
      if (u.pathname === "/warm") return Response.json({ loaded: true });
      const n = (await req.arrayBuffer()).byteLength / 4;
      return Response.json({ text: `  ${n} samples ` });
    },
  });
  process.env.TEF_NOTES_STT = `http://localhost:${fake.port}/`;
});
afterAll(() => { fake.stop(true); delete process.env.TEF_NOTES_STT; });

const post = (path: string, body?: BodyInit) => new Request(`http://agent/agent/${path}`, { method: "POST", body });

test("passes the samples and the keep setting, answers the trimmed text", async () => {
  const r = await transcribe(post("transcribe?keep=900", new Float32Array(16).buffer));
  expect(await r.json()).toEqual({ text: "16 samples" });
  expect(seen.at(-1)).toBe("/transcribe?keep=900");
});

test("an unknown keep falls back to the default", async () => {
  await transcribe(post("transcribe?keep=7", new Float32Array(4).buffer));
  expect(seen.at(-1)).toBe("/transcribe?keep=300");
});

test("refuses a body that is not float32 samples", async () => {
  expect((await transcribe(post("transcribe?keep=0", new Uint8Array(3)))).status).toBe(400);
});

test("warm loads the model", async () => {
  expect((await warm(post("transcribe/warm?keep=60"))).status).toBe(204);
  expect(seen.at(-1)).toBe("/warm?keep=60");
});

test("off without TEF_NOTES_STT", async () => {
  const was = process.env.TEF_NOTES_STT;
  delete process.env.TEF_NOTES_STT;
  expect((await transcribe(post("transcribe?keep=0", new Float32Array(4).buffer))).status).toBe(404);
  process.env.TEF_NOTES_STT = was;
});
