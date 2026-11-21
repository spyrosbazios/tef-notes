// The render process (src/render.ts over render-child.ts): it answers every op; a job that overruns its time or kills the
// process fails alone, and the next one is served by a new process; and none of it runs on the caller's event loop.
import { afterAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Renderer, render, RenderError, TIMEOUT_MS } from "../src/render";
import { makePdf } from "./pdf";

const jpeg = (b: Uint8Array) => [...b.slice(0, 2)];

describe("render process", () => {
  afterAll(() => render().stop());

  it("answers each op: text, page count, a first page's JPEG, a JPEG shrunk, a drawing's PNG", async () => {
    const pdf = makePdf(["Page one rent 900", "Page two deposit"]);
    expect(await render().run("text", { pdf })).toEqual(["Page one rent 900", "Page two deposit"]);
    expect(await render().run("pages", { pdf })).toBe(2);
    const big = await render().run("thumb", { pdf, width: 640, quality: 0.8 });
    expect(jpeg(big)).toEqual([0xff, 0xd8]);
    const small = await render().run("shrink", { jpeg: big, width: 32 });
    expect(jpeg(small)).toEqual([0xff, 0xd8]);
    expect(small.length).toBeLessThan(big.length);
    const png = await render().run("drawing", { scene: { type: "excalidraw", elements: [{ id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 50 }] } });
    expect([...png.slice(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
  });

  it("fails a job whose file is broken without ending the process", async () => {
    const err = await render().run("text", { pdf: new TextEncoder().encode("not a PDF") }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect((err as RenderError).reason).toBe("failed");
    expect(await render().run("pages", { pdf: makePdf(["x"]) })).toBe(1);
  });

  it("takes bytes when its turn comes, and a failure fetching them is that error, not the queue's", async () => {
    const order: string[] = [];
    const first = render().run("pages", async () => { order.push("first"); return { pdf: makePdf(["a"]) }; });
    const bad = render().run("pages", async () => { order.push("bad"); throw new Error("HTTP 502"); });
    const last = render().run("pages", async () => { order.push("last"); return { pdf: makePdf(["a", "b"]) }; });
    expect(await first).toBe(1);
    expect(await bad.catch((e: Error) => e.message)).toBe("HTTP 502");
    expect(await last).toBe(2);
    expect(order).toEqual(["first", "bad", "last"]);
  });

  it("keeps every op under a limit", () => {
    for (const ms of Object.values(TIMEOUT_MS)) expect(ms).toBeGreaterThan(0);
  });
});

describe("render process: a stand-in that hangs, dies and works", () => {
  const entry = join(import.meta.dir, "render-fixture.ts");
  const r = new Renderer(entry, { text: 200, pages: 1000, thumb: 200, shrink: 5000, drawing: 200 });
  afterAll(() => r.stop());

  it("answers, with a large payload both ways", async () => {
    expect(await r.run("pages", { pdf: new Uint8Array(3) })).toBe(3);
    const big = new Uint8Array(8 * 1024 * 1024).fill(7);
    const back = await r.run("shrink", { jpeg: big, width: 1 });
    expect([back.length, back[0], back.at(-1)]).toEqual([big.length, 7, 7]);
  });

  it("times a hung job out, fails it alone, and serves the next with a new process", async () => {
    const hung = r.run("pages", { pdf: new Uint8Array([1]) });
    const queued = r.run("pages", { pdf: new Uint8Array([0, 0]) });      // behind it: its own clock starts when it is taken
    const err = await hung.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect(err as RenderError).toMatchObject({ reason: "timeout", message: "pages took longer than 1 s" });
    expect(await queued).toBe(2);
    expect(await r.run("pages", { pdf: new Uint8Array(4) })).toBe(4);
  });

  it("starts a new process after one dies in a job", async () => {
    const err = await r.run("pages", { pdf: new Uint8Array([2]) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect((err as RenderError).reason).toBe("died");
    expect(await r.run("pages", { pdf: new Uint8Array(5) })).toBe(5);
  });

  it("works off the caller's event loop: its timers go on while a job spends 300 ms of CPU", async () => {
    let last = performance.now(), worst = 0;
    const tick = setInterval(() => { const t = performance.now(); worst = Math.max(worst, t - last); last = t; }, 10);
    const done = await r.run("shrink", { jpeg: new Uint8Array([3]), width: 1 });
    clearInterval(tick);
    expect(done.length).toBe(1);
    expect(worst).toBeLessThan(150);
  });

  it("can be stopped, and starts again with the next job", async () => {
    r.stop();
    expect(await r.run("pages", { pdf: new Uint8Array(6) })).toBe(6);
  });
});
