import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wavOf } from "../src/fish";
import { transcribe } from "../src/transcribe";

// A keys directory of our own, holding the one key the route reads (keys.ts re-reads it on every use).
const dir = mkdtempSync(join(tmpdir(), "fish-keys-"));
mkdirSync(join(dir, "fish"), { recursive: true });
writeFileSync(join(dir, "fish", "api-key"), "test-key\n");
process.env.TEF_NOTES_KEYS_DIR = dir;

type Seen = { url: string; model: string | null; body: Uint8Array | null };
const seen: Seen[] = [];
let answer: () => Response = () => Response.json({ text: "  what I said " });
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://api.fish.audio")) return realFetch(input as never, init);
    const form = init?.body instanceof FormData ? init.body : null;
    const file = form?.get("audio");
    const headers = new Headers(init?.headers);
    seen.push({
      url,
      model: headers.get("model"),
      body: file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : null,
    });
    return answer();
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true });
  delete process.env.TEF_NOTES_KEYS_DIR;
});

const post = (body: BodyInit) => new Request("http://agent/agent/transcribe", { method: "POST", body });

test("sends the piece to Fish as a WAV and answers its text, trimmed", async () => {
  const r = await transcribe(post(new Float32Array(16).fill(0.5).buffer));
  expect(await r.json()).toEqual({ text: "what I said" });
  const last = seen.at(-1)!;
  expect(last.url).toBe("https://api.fish.audio/v1/asr");
  expect(last.model).toBe("transcribe-1-pro");
  expect(new TextDecoder().decode(last.body!.slice(0, 4))).toBe("RIFF");
  expect(last.body!.byteLength).toBe(44 + 16 * 2);
});

test("the WAV is 16 kHz mono, 16-bit", () => {
  const view = new DataView(wavOf(new Float32Array([0, 1, -1])).buffer);
  expect(view.getUint32(24, true)).toBe(16_000);
  expect(view.getUint16(22, true)).toBe(1);
  expect(view.getUint16(34, true)).toBe(16);
  expect(view.getInt16(44 + 2, true)).toBe(0x7fff);
  expect(view.getInt16(44 + 4, true)).toBe(-0x7fff);
});

test("refuses a body that is not float32 samples", async () => {
  expect((await transcribe(post(new Uint8Array(3)))).status).toBe(400);
});

test("Fish's own refusal is a 502, not a lie about what was said", async () => {
  const was = answer;
  answer = () => Response.json({ message: "upstream_unavailable" }, { status: 503 });
  expect((await transcribe(post(new Float32Array(4).buffer))).status).toBe(502);
  answer = was;
});

test("off without the Fish key: the route answers 404", async () => {
  rmSync(join(dir, "fish"), { recursive: true, force: true });
  expect((await transcribe(post(new Float32Array(4).buffer))).status).toBe(404);
  mkdirSync(join(dir, "fish"), { recursive: true });
  writeFileSync(join(dir, "fish", "api-key"), "test-key\n");
});
