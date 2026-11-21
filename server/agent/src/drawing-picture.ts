// A drawing's PNG made on the server, for a scene written outside the web's editor (the CLI's `tefnotes draw`): the picture
// the chip, the tile and the phone show beside the `.excalidraw` file (core/photos.ts `drawingPreview`). The web's own saves
// export through Excalidraw itself; this draws the same elements plainly (drawing-paint.ts, in the render process: straight
// strokes, no hand-drawn roughness), close enough for a preview, and the web's next Save replaces it with Excalidraw's.
// Route: POST /agent/drawing-picture.
import { sceneProblem } from "@/core/drawing";
import { render } from "./render";

const MAX_BYTES = 4 * 1024 * 1024;

/** The PNG of a scene (an `.excalidraw` file's JSON), or why it can't be drawn. */
export async function drawingPicture(scene: unknown): Promise<Uint8Array | { error: string }> {
  const problem = sceneProblem(scene);
  return problem ? { error: problem } : render().run("drawing", { scene });
}

/** POST /agent/drawing-picture, the scene's JSON in the body: its PNG, 422 when it isn't a scene. */
export async function drawingPictureRoute(req: Request): Promise<Response> {
  const body = await req.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return new Response("A scene of at most 4 MB", { status: 413 });
  let scene: unknown;
  try { scene = JSON.parse(new TextDecoder().decode(body)); } catch { return new Response("The body isn't JSON", { status: 422 }); }
  let out: Uint8Array | { error: string };
  try { out = await drawingPicture(scene); } catch (e) { return new Response(`Couldn't draw it: ${(e as Error).message}`, { status: 500 }); }
  if (!(out instanceof Uint8Array)) return new Response(out.error, { status: 422 });
  return new Response(new Blob([out as Uint8Array<ArrayBuffer>], { type: "image/png" }));
}
