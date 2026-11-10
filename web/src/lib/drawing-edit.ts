// An agent's edit (core/drawing.ts `DrawEdit`) made on an Excalidraw scene: the shapes it adds built by Excalidraw itself
// (`convertToExcalidrawElements`, which measures and centres labels), the ones it changes rebuilt the same way in their place
// with the style the owner gave them kept, the ones it removes deleted. Excalidraw's converter binds an arrow to the shapes it
// names but leaves it where it was put, so an arrow's two ends are worked out here, from edge to edge of the shapes it joins,
// and again for every arrow on a shape that moved. Every change goes out as a new version of its element, so the editor takes
// the whole edit as one step its Undo takes back (drawing-canvas.tsx). Imported by the editor's chunk only: Excalidraw is heavy.
import { convertToExcalidrawElements, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { ExcalidrawElement, ExcalidrawTextElement, PointBinding } from "@excalidraw/excalidraw/element/types";
import { DRAW_COLORS, editProblem, FONT_SIZES, shapesOf, type DrawAdd, type DrawEdit, type DrawUpdate, type Shape } from "@/core/drawing";

/** How far an arrow stops short of the shapes it joins. */
const GAP = 8;
/** Excalidraw's roundness kinds: a rectangle's corners, a diamond's or an ellipse's. */
const ADAPTIVE = 3, PROPORTIONAL = 2;

type Box = { x: number; y: number; w: number; h: number };
type Skeleton = ExcalidrawElementSkeleton;
type Element = ExcalidrawElement;

const boxOf = (e: Element): Box => ({ x: e.x, y: e.y, w: e.width, h: e.height });
const isLine = (e: Element) => e.type === "arrow" || e.type === "line";

/** Where an arrow from `a` to `b` starts and ends: on each box's edge, toward the other's centre, `GAP` short of it. */
export function ends(a: Box, b: Box): { from: [number, number]; to: [number, number] } {
  const ca: [number, number] = [a.x + a.w / 2, a.y + a.h / 2], cb: [number, number] = [b.x + b.w / 2, b.y + b.h / 2];
  let dx = cb[0] - ca[0], dy = cb[1] - ca[1];
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) { dx = 1; dy = 0; }
  const len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
  /** How far from a box's centre its edge is, along (ux, uy). */
  const reach = (box: Box) => Math.min(ux ? box.w / 2 / Math.abs(ux) : Infinity, uy ? box.h / 2 / Math.abs(uy) : Infinity);
  const ra = reach(a) + GAP, rb = reach(b) + GAP;
  // Boxes too close for an arrow between their edges: centre to centre, so it still points the right way
  if (ra + rb >= len) return { from: ca, to: cb };
  return { from: [ca[0] + ux * ra, ca[1] + uy * ra], to: [cb[0] - ux * rb, cb[1] - uy * rb] };
}

const stroke = (n: Shape["stroke"]) => (n ? DRAW_COLORS[n].stroke : DRAW_COLORS.black.stroke);
const fill = (n: Shape["fill"]) => (n ? DRAW_COLORS[n].fill : "transparent");

/** A shape's own look, as the edit has it, over `kept`: what the owner had given the element before. */
function looks(s: Shape, kept: Partial<Element> | undefined) {
  return {
    strokeColor: s.stroke || !kept ? stroke(s.stroke) : kept.strokeColor,
    backgroundColor: s.fill || !kept ? fill(s.fill) : kept.backgroundColor,
    fillStyle: kept?.fillStyle ?? "solid",
    strokeWidth: kept?.strokeWidth ?? 2,
    strokeStyle: s.dashed ? "dashed" as const : kept && kept.strokeStyle !== "dashed" && kept.strokeStyle !== "dotted" ? kept.strokeStyle : "solid" as const,
    roughness: kept?.roughness ?? 1,
    opacity: kept?.opacity ?? 100,
  };
}

/** The label's look: its size, and the colour of the shape's lines. */
const label = (s: Shape, kept: ExcalidrawTextElement | undefined) => ({
  text: s.text ?? "", strokeColor: s.stroke ? stroke(s.stroke) : kept?.strokeColor ?? stroke(undefined),
  fontSize: s.size ? FONT_SIZES[s.size] : kept?.fontSize ?? FONT_SIZES.m, ...(kept ? { fontFamily: kept.fontFamily } : {}),
});

/** The skeleton Excalidraw builds a box or a text from. */
function boxSkeleton(s: Shape, kept: Element | undefined, keptLabel: ExcalidrawTextElement | undefined): Skeleton {
  const base = { id: s.id, x: s.x, y: s.y, ...looks(s, kept) };
  if (s.type === "text") {
    const t = kept?.type === "text" ? kept : undefined;
    return { ...base, type: "text", text: s.text ?? "", fontSize: s.size ? FONT_SIZES[s.size] : t?.fontSize ?? FONT_SIZES.m, ...(t ? { fontFamily: t.fontFamily } : {}), backgroundColor: "transparent" };
  }
  const type = s.type === "ellipse" || s.type === "diamond" ? s.type : "rectangle";
  return {
    ...base, type, width: s.w, height: s.h,
    roundness: kept ? kept.roundness : { type: type === "rectangle" ? ADAPTIVE : PROPORTIONAL },
    ...(s.text ? { label: label(s, keptLabel) } : {}),
  };
}

/** The skeleton of a line or arrow from `from` to `to`, its label and its look. */
function lineSkeleton(s: Shape, from: [number, number], to: [number, number], kept: Element | undefined, keptLabel: ExcalidrawTextElement | undefined): Skeleton {
  const w = to[0] - from[0], h = to[1] - from[1];
  // Excalidraw draws it from its start to (w, h) from there
  const base = { id: s.id, x: from[0], y: from[1], width: w, height: h, ...looks(s, kept), backgroundColor: "transparent" };
  return s.type === "line" ? { ...base, type: "line" } : { ...base, type: "arrow", ...(s.text ? { label: label(s, keptLabel) } : {}) };
}

const binding = (id: string): PointBinding => ({ elementId: id, focus: 0, gap: GAP });

/** The scene with `edit` made on it, or why it can't be: `all` is the scene as Excalidraw holds it, deleted elements included. */
export function edited(all: readonly Element[], edit: DrawEdit): { elements: Element[] } | { error: string } {
  const now = all.filter((e) => !e.isDeleted), shapes = shapesOf(now);
  const problem = editProblem(edit, shapes);
  if (problem) return { error: problem };

  // The scene as a list to change in place (an element keeps its place in the stack) and a map to look things up by
  const list: Element[] = [...all];
  const at = new Map(list.map((e, i) => [e.id, i]));
  const get = (id: string) => { const i = at.get(id); return i == null ? undefined : list[i]; };
  const put = (e: Element) => { const i = at.get(e.id); if (i == null) { at.set(e.id, list.length); list.push(e); } else list[i] = e; };
  const labelOf = (id: string) => list.find((e): e is ExcalidrawTextElement => e.type === "text" && !e.isDeleted && e.containerId === id);
  const drop = (id: string) => { const e = get(id); if (e && !e.isDeleted) put(newElementWith(e, { isDeleted: true })); };
  /** Adds or takes off references in an element's boundElements. */
  const rebind = (id: string, add: { id: string; type: "arrow" | "text" }[], remove: ReadonlySet<string> = new Set()) => {
    const e = get(id);
    if (!e) return;
    const kept = (e.boundElements ?? []).filter((b) => !remove.has(b.id) && !add.some((a) => a.id === b.id));
    put(newElementWith(e, { boundElements: [...kept, ...add] }));
  };
  const shapeOf = new Map(shapes.map((s) => [s.id, s]));
  const arrowsOn = (id: string) => list.filter((e) => !e.isDeleted && e.type === "arrow" && (e.startBinding?.elementId === id || e.endBinding?.elementId === id));

  // Removed: the shape, its label; arrows on it keep their place, unbound from it
  const removed = new Set(edit.remove ?? []);
  for (const id of removed) {
    const l = labelOf(id);
    if (l) drop(l.id);
    for (const a of arrowsOn(id)) {
      if (a.type !== "arrow") continue;
      put(newElementWith(a, { startBinding: a.startBinding?.elementId === id ? null : a.startBinding, endBinding: a.endBinding?.elementId === id ? null : a.endBinding }));
    }
    drop(id);
  }

  /** Builds `skeletons` with Excalidraw and puts them in: an element there already is replaced by a new version of it, which
   *  keeps its place, its group and the arrows on it; one that is new goes on top, its label just above it. */
  const build = (skeletons: Skeleton[]) => {
    const made = convertToExcalidrawElements(skeletons, { regenerateIds: false });
    for (const m of made) {
      const old = get(m.id);
      if (!old) { put(m); continue; }
      // A new version of the old one: its place, group and frame, the arrows on it, a version past its own
      const arrows = (old.boundElements ?? []).filter((b) => b.type === "arrow");
      put({
        ...m, index: old.index, seed: old.seed, groupIds: old.groupIds, frameId: old.frameId, boundElements: [...(m.boundElements ?? []), ...arrows],
        version: old.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now(),
      });
    }
  };

  // Changed: rebuilt from the shape as it was with the edit's fields over it; its old label goes (the new one is built with it)
  const moved = new Set<string>();
  const merged = (u: DrawUpdate): Shape => {
    const s = shapeOf.get(u.id)!;
    const next: Shape = { ...s, ...(u.x != null ? { x: u.x } : {}), ...(u.y != null ? { y: u.y } : {}), ...(u.w != null ? { w: u.w } : {}), ...(u.h != null ? { h: u.h } : {}) };
    if (u.text != null) next.text = u.text;
    if (u.stroke) next.stroke = u.stroke;
    if (u.fill === "none") delete next.fill; else if (u.fill) next.fill = u.fill;
    if (u.dashed != null) { if (u.dashed) next.dashed = true; else delete next.dashed; }
    if (u.size) next.size = u.size;
    return next;
  };
  const lines: { s: Shape; kept?: Element; label?: ExcalidrawTextElement }[] = [];
  for (const u of edit.update ?? []) {
    const old = get(u.id)!, s = merged(u), l = labelOf(u.id);
    if (s.type === "freedraw" || s.type === "image" || s.type === "frame") {
      // Not rebuilt (a stroke's points, a picture's file): moved, resized and recoloured in place
      put(newElementWith(old, { x: s.x, y: s.y, width: s.w, height: s.h, ...(u.stroke ? { strokeColor: stroke(u.stroke) } : {}) }));
      moved.add(u.id);
      continue;
    }
    if (isLine(old)) { lines.push({ s, kept: old, label: l }); continue; }
    if (l) { drop(l.id); rebind(u.id, [], new Set([l.id])); }
    build([boxSkeleton(s, get(u.id), l)]);
    if (s.x !== shapeOf.get(u.id)!.x || s.y !== shapeOf.get(u.id)!.y || s.w !== shapeOf.get(u.id)!.w || s.h !== shapeOf.get(u.id)!.h || u.text != null || u.size) moved.add(u.id);
  }

  // Added: boxes and texts first, so the arrows can be laid between them
  const adds: DrawAdd[] = edit.add ?? [];
  const added = (a: DrawAdd): Shape => ({
    id: a.id, type: a.type, x: a.x ?? 0, y: a.y ?? 0, w: a.w ?? 0, h: a.h ?? 0,
    ...(a.text ? { text: a.text } : {}), ...(a.from ? { from: a.from } : {}), ...(a.to ? { to: a.to } : {}),
    ...(a.stroke ? { stroke: a.stroke } : {}), ...(a.fill ? { fill: a.fill } : {}), ...(a.dashed ? { dashed: true as const } : {}), ...(a.size ? { size: a.size } : {}),
  });
  build(adds.filter((a) => a.type !== "arrow" && a.type !== "line").map((a) => boxSkeleton(added(a), undefined, undefined)));
  for (const a of adds) if (a.type === "arrow" || a.type === "line") lines.push({ s: added(a) });

  // Lines and arrows: an arrow's ends from the shapes it joins, else from its own place and size
  const lay = ({ s, kept, label: l }: { s: Shape; kept?: Element; label?: ExcalidrawTextElement }) => {
    const was = kept?.type === "arrow" ? kept : undefined;
    const fromId = s.from ?? was?.startBinding?.elementId, toId = s.to ?? was?.endBinding?.elementId;
    const a = fromId ? get(fromId) : undefined, b = toId ? get(toId) : undefined;
    let from: [number, number] = [s.x, s.y], to: [number, number] = [s.x + s.w, s.y + s.h];
    if (a && b) ({ from, to } = ends(boxOf(a), boxOf(b)));
    else if (a) from = ends(boxOf(a), { x: to[0], y: to[1], w: 0, h: 0 }).from;
    else if (b) to = ends({ x: from[0], y: from[1], w: 0, h: 0 }, boxOf(b)).to;
    if (l) { drop(l.id); rebind(s.id, [], new Set([l.id])); }
    build([lineSkeleton(s, from, to, kept, l)]);
    const arrow = get(s.id);
    if (arrow?.type !== "arrow") return;
    put(newElementWith(arrow, { startBinding: a ? binding(a.id) : null, endBinding: b ? binding(b.id) : null }));
    if (a) rebind(a.id, [{ id: s.id, type: "arrow" }]);
    if (b) rebind(b.id, [{ id: s.id, type: "arrow" }]);
  };
  for (const l of lines) lay(l);

  // Arrows on a shape that moved, grew or was relabelled follow it
  const laid = new Set(lines.map((l) => l.s.id));
  for (const id of moved) {
    for (const a of arrowsOn(id)) {
      if (laid.has(a.id) || removed.has(a.id)) continue;
      laid.add(a.id);
      const s = shapesOf([a, ...list.filter((e) => e.type === "text" && e.containerId === a.id && !e.isDeleted)])[0];
      if (s) lay({ s, kept: a, label: labelOf(a.id) });
    }
  }
  return { elements: list };
}
