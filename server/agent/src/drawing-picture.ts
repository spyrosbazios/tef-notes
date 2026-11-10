// A drawing's PNG made on the server, for a scene written outside the web's editor (the CLI's `tefnotes draw`): the picture
// the chip, the tile and the phone show beside the `.excalidraw` file (core/photos.ts `drawingPreview`). The web's own saves
// export through Excalidraw itself; this draws the same elements plainly (straight strokes, Liberation Sans, no hand-drawn
// roughness), close enough for a preview, and the web's next Save replaces it with Excalidraw's. Route: POST /agent/drawing-picture.
import { sceneProblem } from "@/core/drawing";

/** The longest side of the picture, as the web's PREVIEW_EDGE; the padding around the shapes, as its exportPadding. */
const EDGE = 1600, PAD = 16, MAX_BYTES = 4 * 1024 * 1024;
const FONT = '"Liberation Sans", sans-serif';

type El = Record<string, any>;
type Ctx = import("@napi-rs/canvas").SKRSContext2D;

const n = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const pointsOf = (e: El): [number, number][] =>
  (Array.isArray(e.points) ? e.points : []).filter((p: unknown) => Array.isArray(p)).map((p: unknown[]) => [n(p[0]), n(p[1])]);
const hasPoints = (e: El) => e.type === "arrow" || e.type === "line" || e.type === "freedraw";

/** The box an element covers, unrotated. */
function box(e: El): [number, number, number, number] {
  const x = n(e.x), y = n(e.y);
  if (!hasPoints(e)) return [x, y, x + n(e.width), y + n(e.height)];
  const ps = pointsOf(e);
  if (!ps.length) return [x, y, x, y];
  const xs = ps.map((p) => x + p[0]), ys = ps.map((p) => y + p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function stroke(ctx: Ctx, e: El) {
  ctx.strokeStyle = typeof e.strokeColor === "string" ? e.strokeColor : "#1e1e1e";
  ctx.lineWidth = Math.max(1, n(e.strokeWidth, 2));
  ctx.setLineDash(e.strokeStyle === "dashed" ? [8, 6] : e.strokeStyle === "dotted" ? [2, 5] : []);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
}

const filled = (e: El) => typeof e.backgroundColor === "string" && e.backgroundColor !== "transparent";

function outline(ctx: Ctx, e: El) {
  const x = n(e.x), y = n(e.y), w = n(e.width), h = n(e.height);
  ctx.beginPath();
  if (e.type === "ellipse") ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
  else if (e.type === "diamond") { ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + h / 2); ctx.lineTo(x + w / 2, y + h); ctx.lineTo(x, y + h / 2); ctx.closePath(); }
  else if (e.roundness) ctx.roundRect(x, y, w, h, Math.min(Math.abs(w), Math.abs(h)) * 0.25);
  else ctx.rect(x, y, w, h);
  if (filled(e)) { ctx.fillStyle = e.backgroundColor; ctx.fill(); }
  stroke(ctx, e); ctx.stroke();
}

function head(ctx: Ctx, at: [number, number], from: [number, number], size: number) {
  const a = Math.atan2(at[1] - from[1], at[0] - from[0]);
  ctx.beginPath(); ctx.setLineDash([]);
  for (const s of [-1, 1]) { ctx.moveTo(at[0], at[1]); ctx.lineTo(at[0] - size * Math.cos(a + (s * Math.PI) / 7), at[1] - size * Math.sin(a + (s * Math.PI) / 7)); }
  ctx.stroke();
}

function path(ctx: Ctx, e: El) {
  const x = n(e.x), y = n(e.y), ps = pointsOf(e).map(([px, py]) => [x + px, y + py] as [number, number]);
  if (ps.length < 2) return;
  ctx.beginPath(); ctx.moveTo(...ps[0]!);
  for (const p of ps.slice(1)) ctx.lineTo(...p);
  stroke(ctx, e);
  if (e.type === "freedraw") ctx.lineWidth = Math.max(1, n(e.strokeWidth, 2) * 1.5);
  if (e.type === "line" && filled(e) && ps.length > 2) { ctx.closePath(); ctx.fillStyle = e.backgroundColor; ctx.fill(); }
  ctx.stroke();
  if (e.type !== "arrow") return;
  const size = 10 + ctx.lineWidth * 2;
  if (e.endArrowhead !== null) head(ctx, ps.at(-1)!, ps.at(-2)!, size);
  if (e.startArrowhead) head(ctx, ps[0]!, ps[1]!, size);
}

/** A text element, or a label: one bound to a container with no place of its own is centred in it. */
function text(ctx: Ctx, e: El, byId: Map<string, El>) {
  const words = typeof e.text === "string" ? e.text : typeof e.originalText === "string" ? e.originalText : "";
  if (!words) return;
  const size = n(e.fontSize, 20), lh = size * n(e.lineHeight, 1.25), lines = words.split("\n");
  const c = typeof e.containerId === "string" ? byId.get(e.containerId) : undefined;
  let x = n(e.x), y = n(e.y), w = n(e.width), h = n(e.height);
  if (c && !w) { const [x0, y0, x1, y1] = box(c); w = x1 - x0; h = lines.length * lh; x = x0; y = (y0 + y1) / 2 - h / 2; }
  const align = c && !n(e.width) ? "center" : e.textAlign === "center" || e.textAlign === "right" ? e.textAlign : "left";
  ctx.font = `${size}px ${FONT}`; ctx.fillStyle = typeof e.strokeColor === "string" ? e.strokeColor : "#1e1e1e";
  ctx.textAlign = align; ctx.textBaseline = "middle";
  const ax = align === "center" ? x + w / 2 : align === "right" ? x + w : x;
  lines.forEach((line, i) => ctx.fillText(line, ax, y + lh * i + lh / 2));
}

/** The PNG of a scene (an `.excalidraw` file's JSON), or why it can't be drawn. */
export async function drawingPicture(scene: unknown): Promise<Uint8Array | { error: string }> {
  const problem = sceneProblem(scene);
  if (problem) return { error: problem };
  const els = ((scene as { elements: El[] }).elements).filter((e) => e && typeof e === "object" && e.isDeleted !== true);
  const byId = new Map(els.map((e) => [String(e.id), e]));
  const boxes = els.map(box);
  const x0 = Math.min(...boxes.map((b) => b[0])) - PAD, y0 = Math.min(...boxes.map((b) => b[1])) - PAD;
  const w = Math.max(...boxes.map((b) => b[2])) + PAD - x0, h = Math.max(...boxes.map((b) => b[3])) + PAD - y0;
  const k = Math.min(1, EDGE / Math.max(w, h));
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))), ctx = canvas.getContext("2d");
  const bg = (scene as { appState?: { viewBackgroundColor?: unknown } }).appState?.viewBackgroundColor;
  ctx.fillStyle = typeof bg === "string" ? bg : "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(k, k); ctx.translate(-x0, -y0);
  for (const e of els) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, n(e.opacity, 100) / 100));
    const angle = n(e.angle);
    if (angle && !hasPoints(e)) { const [bx0, by0, bx1, by1] = box(e), cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2; ctx.translate(cx, cy); ctx.rotate(angle); ctx.translate(-cx, -cy); }
    if (e.type === "rectangle" || e.type === "ellipse" || e.type === "diamond") outline(ctx, e);
    else if (hasPoints(e)) path(ctx, e);
    else if (e.type === "text") text(ctx, e, byId);
    else if (e.type === "frame" || e.type === "magicframe") { stroke(ctx, { ...e, strokeColor: "#bbbbbb", strokeWidth: 1 }); ctx.strokeRect(n(e.x), n(e.y), n(e.width), n(e.height)); }
    ctx.restore();
  }
  return new Uint8Array(await canvas.encode("png"));
}

/** POST /agent/drawing-picture, the scene's JSON in the body: its PNG, 422 when it isn't a scene. */
export async function drawingPictureRoute(req: Request): Promise<Response> {
  const body = await req.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return new Response("A scene of at most 4 MB", { status: 413 });
  let scene: unknown;
  try { scene = JSON.parse(new TextDecoder().decode(body)); } catch { return new Response("The body isn't JSON", { status: 422 }); }
  const out = await drawingPicture(scene);
  if (!(out instanceof Uint8Array)) return new Response(out.error, { status: 422 });
  return new Response(new Blob([out as Uint8Array<ArrayBuffer>], { type: "image/png" }));
}
