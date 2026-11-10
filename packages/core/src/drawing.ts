// A drawing as the agent sees and changes it: not Excalidraw's scene (hundreds of fields per element, the model choosing
// seeds and versions), but shapes, each a box with an id, a kind, its text and colours, and arrows naming the shapes they
// join. Two directions:
//  - read: `shapesOf` turns a scene's elements into shapes, what the assistant's `<screen>` shows of the drawing open in the
//    web's editor (core/assistant.ts `drawing`) and what the agent's `read_drawing` returns of a saved one;
//  - write: a `DrawEdit` (shapes to add, fields to change, ids to remove) is the input of the `draw` UI tool. The web's editor
//    applies it to the open canvas (web/src/lib/drawing-edit.ts), where it is the owner's to keep (Save) or undo, as their own
//    strokes are: an edit is never saved by itself.
// Excalidraw lays text out and binds arrows itself, so the model gives positions and sizes only. Pure: no "ai", DOM or
// Excalidraw import (the sidecar loads this file outside the clients' node_modules).

// ---- the shapes

/** What a shape can be. The agent adds the first six; `freedraw` (a pen stroke), `image` and `frame` are only read. */
export const DRAW_KINDS = ["rectangle", "ellipse", "diamond", "text", "arrow", "line"] as const;
export type DrawKind = (typeof DRAW_KINDS)[number];
export const SHAPE_KINDS = [...DRAW_KINDS, "freedraw", "image", "frame"] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** The colours a shape may have, by name: Excalidraw's palette, a strong shade for lines and text, a light one for fills. */
export const DRAW_COLORS = {
  black: { stroke: "#1e1e1e", fill: "#e9ecef" },
  gray: { stroke: "#868e96", fill: "#dee2e6" },
  red: { stroke: "#e03131", fill: "#ffc9c9" },
  pink: { stroke: "#c2255c", fill: "#fcc2d7" },
  violet: { stroke: "#6741d9", fill: "#d0bfff" },
  blue: { stroke: "#1971c2", fill: "#a5d8ff" },
  teal: { stroke: "#0c8599", fill: "#99e9f2" },
  green: { stroke: "#2f9e44", fill: "#b2f2bb" },
  yellow: { stroke: "#f08c00", fill: "#ffec99" },
  orange: { stroke: "#e8590c", fill: "#ffd8a8" },
} as const;
export type DrawColor = keyof typeof DRAW_COLORS;
export const DRAW_COLOR_NAMES = Object.keys(DRAW_COLORS) as DrawColor[];

/** Text sizes, as Excalidraw's S, M, L and XL. */
export const FONT_SIZES = { s: 16, m: 20, l: 28, xl: 36 } as const;
export type FontSize = keyof typeof FONT_SIZES;

/** One shape. `x`, `y`: its top-left; `w`, `h`: its size (a line's or an arrow's: where it ends, from its start, so either may
 *  be negative). `text`: a box's label, a text's words, an arrow's label. `from`, `to`: the shapes an arrow joins. */
export type Shape = {
  id: string; type: ShapeKind; x: number; y: number; w: number; h: number;
  text?: string; from?: string; to?: string; stroke?: DrawColor; fill?: DrawColor; dashed?: true; size?: FontSize;
};

/** How much one edit may do, and how much of a drawing the agent is shown. */
export const DRAWING_LIMITS = { id: 40, text: 500, coord: 20_000, size: 8000, add: 200, update: 200, remove: 200, shown: 150 } as const;

// ---- reading a scene

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");

const STROKES = new Map<string, DrawColor>(DRAW_COLOR_NAMES.map((n) => [DRAW_COLORS[n].stroke, n]));
const FILLS = new Map<string, DrawColor>(DRAW_COLOR_NAMES.map((n) => [DRAW_COLORS[n].fill, n]));
const SIZES = new Map<number, FontSize>((Object.keys(FONT_SIZES) as FontSize[]).map((k) => [FONT_SIZES[k], k]));

/** A colour's name, by its stroke or fill shade: one of another shade has none (left out, the shape reads as plain). */
export const strokeName = (hex: unknown): DrawColor | undefined => STROKES.get(str(hex).toLowerCase());
export const fillName = (hex: unknown): DrawColor | undefined => FILLS.get(str(hex).toLowerCase());

/** The text an element shows: a text element's words (its original, unwrapped ones). */
const wordsOf = (e: Record<string, unknown>) => str(e.originalText) || str(e.text);

/** The shapes a scene's elements make, in their order (the last one on top), a box's or an arrow's text folded into it; deleted
 *  and unknown elements left out. `elements` is untrusted (a saved file, another version's): anything malformed is skipped. */
export function shapesOf(elements: unknown): Shape[] {
  const all = (Array.isArray(elements) ? elements : []).map(obj).filter((e): e is Record<string, unknown> => !!e && e.isDeleted !== true && typeof e.id === "string");
  const labels = new Map<string, string>();
  for (const e of all) if (e.type === "text" && typeof e.containerId === "string") labels.set(e.containerId, wordsOf(e));
  const out: Shape[] = [];
  for (const e of all) {
    const type = e.type === "magicframe" ? "frame" : e.type;
    if (!(SHAPE_KINDS as readonly unknown[]).includes(type) || (type === "text" && typeof e.containerId === "string")) continue;
    const s: Shape = { id: e.id as string, type: type as ShapeKind, x: num(e.x), y: num(e.y), w: num(e.width), h: num(e.height) };
    if (type === "arrow" || type === "line") {
      // A line's size is where its last point lands, from its start
      const pts = Array.isArray(e.points) ? e.points : [], end = Array.isArray(pts.at(-1)) ? (pts.at(-1) as unknown[]) : [0, 0];
      s.w = num(end[0]); s.h = num(end[1]);
      const from = str(obj(e.startBinding)?.elementId), to = str(obj(e.endBinding)?.elementId);
      if (from) s.from = from;
      if (to) s.to = to;
    }
    const text = type === "text" ? wordsOf(e) : type === "frame" ? str(e.name) : labels.get(s.id);
    if (text) s.text = text.slice(0, DRAWING_LIMITS.text);
    const stroke = strokeName(e.strokeColor), fill = e.backgroundColor === "transparent" ? undefined : fillName(e.backgroundColor);
    if (stroke && stroke !== "black") s.stroke = stroke;
    if (fill && type !== "text" && type !== "freedraw") s.fill = fill;
    if (e.strokeStyle === "dashed" || e.strokeStyle === "dotted") s.dashed = true;
    const size = type === "text" ? SIZES.get(num(e.fontSize)) : undefined;
    if (size && size !== "m") s.size = size;
    out.push(s);
  }
  return out;
}

/** A shape out of untrusted input (a context sent by a client), or null: the reader `contextOf` uses. */
export function shapeOf(raw: unknown): Shape | null {
  const o = obj(raw), id = idOf(o?.id);
  if (!o || !id || !(SHAPE_KINDS as readonly unknown[]).includes(o.type)) return null;
  const s: Shape = { id, type: o.type as ShapeKind, x: num(o.x), y: num(o.y), w: num(o.w), h: num(o.h) };
  const text = str(o.text).slice(0, DRAWING_LIMITS.text), from = idOf(o.from), to = idOf(o.to);
  if (text) s.text = text;
  if (from) s.from = from;
  if (to) s.to = to;
  if (isColor(o.stroke)) s.stroke = o.stroke;
  if (isColor(o.fill)) s.fill = o.fill;
  if (o.dashed === true) s.dashed = true;
  if (isSize(o.size)) s.size = o.size;
  return s;
}

// ---- changing one

export type DrawAdd = {
  id: string; type: DrawKind; x?: number; y?: number; w?: number; h?: number;
  text?: string; from?: string; to?: string; stroke?: DrawColor; fill?: DrawColor; dashed?: boolean; size?: FontSize;
};
/** The fields to change on a shape; `fill: "none"` takes its fill off. */
export type DrawUpdate = {
  id: string; x?: number; y?: number; w?: number; h?: number;
  text?: string; stroke?: DrawColor; fill?: DrawColor | "none"; dashed?: boolean; size?: FontSize;
};
export type DrawEdit = { add?: DrawAdd[]; update?: DrawUpdate[]; remove?: string[] };

const ID = /^[\w-]+$/;
const idOf = (v: unknown) => (typeof v === "string" && v.length >= 1 && v.length <= DRAWING_LIMITS.id && ID.test(v) ? v : "");
export const isColor = (v: unknown): v is DrawColor => typeof v === "string" && v in DRAW_COLORS;
export const isSize = (v: unknown): v is FontSize => typeof v === "string" && v in FONT_SIZES;
const coord = (v: unknown) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= DRAWING_LIMITS.coord;
const extent = (v: unknown) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= DRAWING_LIMITS.size;

const LINES = new Set<string>(["arrow", "line"]);

/** Why an edit can't be made on a drawing holding `shapes`, or null. Each id named once; a new shape's id not taken; an update or
 *  removal names a shape there is; an arrow joins shapes there are (or come with it), never a line or arrow; a box comes with
 *  its place and size, a text with its place and words, a line or arrow with both ends (shapes or a start and a size). */
export function editProblem(edit: DrawEdit, shapes: readonly Pick<Shape, "id" | "type">[]): string | null {
  const add = edit.add ?? [], update = edit.update ?? [], remove = edit.remove ?? [];
  if (!add.length && !update.length && !remove.length) return null;
  if (add.length > DRAWING_LIMITS.add || update.length > DRAWING_LIMITS.update || remove.length > DRAWING_LIMITS.remove)
    return `At most ${DRAWING_LIMITS.add} shapes added, changed or removed in one call: split it.`;
  const there = new Map(shapes.map((s) => [s.id, s.type]));
  const fresh = new Map<string, DrawKind>();
  for (const a of add) {
    if (!idOf(a.id)) return `"${a.id}" isn't a usable id: letters, digits, - and _, up to ${DRAWING_LIMITS.id}.`;
    if (there.has(a.id) || fresh.has(a.id)) return `The id "${a.id}" is taken: give each new shape an id of its own.`;
    fresh.set(a.id, a.type);
  }
  const removed = new Set(remove);
  for (const id of remove) if (!there.has(id)) return `No shape "${id}" to remove.`;
  const ends = (id: string | undefined, a: DrawAdd) => {
    if (id == null) return null;
    const t = fresh.get(id) ?? (removed.has(id) ? undefined : there.get(id));
    if (!t) return `Arrow "${a.id}" joins "${id}", which isn't in the drawing.`;
    if (LINES.has(t)) return `Arrow "${a.id}" joins "${id}", a line: join boxes, ellipses, diamonds or texts.`;
    return null;
  };
  for (const a of add) {
    if (a.text != null && a.text.length > DRAWING_LIMITS.text) return `"${a.id}": text up to ${DRAWING_LIMITS.text} characters.`;
    if (LINES.has(a.type)) {
      const bad = ends(a.from, a) ?? ends(a.to, a);
      if (bad) return bad;
      if (a.type === "line" && (a.from || a.to)) return `"${a.id}" is a line: only an arrow joins shapes.`;
      const pinned = !!a.from && !!a.to;
      if (!pinned && !(coord(a.x) && coord(a.y) && extent(a.w) && extent(a.h))) return `"${a.id}" needs both ends: from and to, or x, y and w, h (where it ends).`;
    } else if (a.type === "text") {
      if (!coord(a.x) || !coord(a.y) || !a.text?.trim()) return `Text "${a.id}" needs x, y and its text.`;
    } else if (!coord(a.x) || !coord(a.y) || !extent(a.w) || !extent(a.h) || a.w! < 1 || a.h! < 1) {
      return `"${a.id}" needs x, y and a positive w and h.`;
    }
  }
  for (const u of update) {
    if (!there.has(u.id) || removed.has(u.id)) return `No shape "${u.id}" to change.`;
    if ((u.x != null && !coord(u.x)) || (u.y != null && !coord(u.y)) || (u.w != null && !extent(u.w)) || (u.h != null && !extent(u.h)))
      return `"${u.id}": x and y within ${DRAWING_LIMITS.coord}, w and h within ${DRAWING_LIMITS.size}.`;
    if (u.text != null && u.text.length > DRAWING_LIMITS.text) return `"${u.id}": text up to ${DRAWING_LIMITS.text} characters.`;
  }
  return null;
}

/** An edit as a line for the chat: "Added 4 shapes, changed 2". */
export function editWords(edit: DrawEdit): string {
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  const parts = [
    edit.add?.length ? `added ${n(edit.add.length, "shape")}` : "",
    edit.update?.length ? `changed ${n(edit.update.length, "shape")}` : "",
    edit.remove?.length ? `removed ${n(edit.remove.length, "shape")}` : "",
  ].filter(Boolean).join(", ");
  return parts ? parts[0].toUpperCase() + parts.slice(1) : "Opened it";
}
