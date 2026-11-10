// The server's PNG of a scene made outside the web's editor (`tefnotes draw`): drawn, sized to the shapes, refused when not a scene.
import { describe, expect, it } from "bun:test";
import { drawingPicture, drawingPictureRoute } from "../src/drawing-picture";

const scene = {
  type: "excalidraw", version: 2,
  elements: [
    { id: "a", type: "rectangle", x: 0, y: 0, width: 200, height: 80, strokeColor: "#1971c2", backgroundColor: "#a5d8ff", roundness: { type: 3 } },
    { id: "a-t", type: "text", x: 0, y: 0, width: 0, height: 0, text: "Start", fontSize: 20, containerId: "a" },
    { id: "b", type: "ellipse", x: 400, y: 0, width: 160, height: 80 },
    { id: "c", type: "arrow", x: 200, y: 40, width: 200, height: 0, points: [[0, 0], [200, 0]], endArrowhead: "arrow" },
    { id: "d", type: "text", x: 0, y: 140, width: 300, height: 25, text: "a note\nover two lines", fontSize: 16 },
    { id: "gone", type: "rectangle", x: 5000, y: 5000, width: 10, height: 10, isDeleted: true },
  ],
};

const size = (png: Uint8Array) => { const v = new DataView(png.buffer, png.byteOffset); return [v.getUint32(16), v.getUint32(20)]; };

describe("drawingPicture", () => {
  it("draws a PNG the size of the live shapes plus padding", async () => {
    const png = await drawingPicture(scene);
    if (!(png instanceof Uint8Array)) throw new Error(png.error);
    expect([...png.slice(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
    expect(size(png)).toEqual([560 + 32, 165 + 32]);           // the deleted one far off doesn't widen it
  });

  it("shrinks a big scene to 1600 on its long side", async () => {
    const png = await drawingPicture({ type: "excalidraw", elements: [{ id: "x", type: "rectangle", x: 0, y: 0, width: 4000, height: 1000 }] });
    if (!(png instanceof Uint8Array)) throw new Error(png.error);
    expect(Math.max(...size(png))).toBe(1600);
  });

  it("refuses what isn't a scene", async () => {
    expect(await drawingPicture({ elements: [] })).toEqual({ error: expect.stringContaining('"type"') });
    expect(await drawingPicture({ type: "excalidraw", elements: [] })).toEqual({ error: "the scene has nothing on it" });
    const r = await drawingPictureRoute(new Request("http://x/agent/drawing-picture", { method: "POST", body: "nope" }));
    expect(r.status).toBe(422);
  });
});
