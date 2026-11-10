// A note's drawings as the agent reads them: the Excalidraw scenes attached to it (ARCHITECTURE.md), turned into shapes
// (core/drawing.ts `shapesOf`) so the model reads what is on one, not its file. Drawing on one is the web editor's (the `draw`
// UI tool, core/assistant.ts "the drawing"): the server never writes a scene.
import { tool, type UIMessage } from "ai";
import { z } from "zod";
import { DIAGRAM_KINDS, diagramGuide, diagramKindsText } from "@/core/diagram-guides";
import { DRAWING_LIMITS, shapesOf, type Shape } from "@/core/drawing";
import { isDrawing, isDrawingName } from "@/core/photos";
import { isNotePath, parseNote } from "@/core/notes";
import * as pb from "@/core/pocketbase";
import type { DrawingWidget } from "@/core/widgets";
import type { Notes } from "./notes";

export type Drawing = Pick<pb.Photo, "rec" | "name" | "file">;

/** The messages with every `draw` answer's picture taken out (core/assistant.ts `DrawOutput`): what a chat is saved as, so a
 *  saved chat holds no image bytes, and what a model that takes no images is sent. The same messages when there is none. */
export function withoutPictures<M extends UIMessage>(ms: M[]): M[] {
  const has = (p: M["parts"][number]) => p.type === "tool-draw" && "output" in p && !!p.output && typeof p.output === "object" && "picture" in p.output;
  if (!ms.some((m) => m.parts.some(has))) return ms;
  return ms.map((m) => (!m.parts.some(has) ? m : {
    ...m,
    parts: m.parts.map((p) => {
      if (!has(p) || !("output" in p)) return p;
      const { picture: _, ...rest } = p.output as Record<string, unknown>;
      return { ...p, output: rest };
    }),
  }));
}

/** The note's drawings (`note`: its own id, parseNote's). */
export async function drawingsOf(server: pb.Server, note: string): Promise<Drawing[]> {
  return (await pb.photos(server, note)).filter((p) => isDrawing(p.name)).map(({ rec, name, file }) => ({ rec, name, file }));
}

/** A drawing's shapes, read from its file. */
export async function shapesIn(server: pb.Server, d: Drawing): Promise<Shape[]> {
  const res = await fetch(pb.photoUrl(server, d));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const scene: unknown = await res.json();
  return shapesOf(scene && typeof scene === "object" ? (scene as { elements?: unknown }).elements : []);
}

/** The note at `path` and its drawing `name`, or why not: the error names the drawings it does have. */
export async function findDrawing(notes: Notes, path: string, name: string): Promise<{ title: string; drawing: Drawing } | { error: string }> {
  const m = isNotePath(path) ? await notes.meta(path) : undefined;
  if (!m) return { error: `No note ${path}.` };
  const n = parseNote(m.path, m.text), list = await drawingsOf(notes.server, n.id), drawing = list.find((d) => d.name === name);
  if (drawing) return { title: n.title, drawing };
  return { error: `${path} has no drawing ${name}.${list.length ? ` It has: ${list.map((d) => d.name).join(", ")}.` : " It has none."}` };
}

const input = z.object({
  path: z.string().describe("The note: notes/<file>.md"),
  name: z.string().refine(isDrawingName, "<name>.excalidraw").describe("The drawing's file name, the last part of its link: sketch.excalidraw"),
});

export function drawingTools(notes: Notes) {
  return {
    diagram_guide: tool({
      description: `How to lay out a kind of diagram well: grid, sizes, shapes and colours by role, what to avoid. Call it once before you draw a diagram or wireframe (not for a quick change to one), and follow it. Kinds: ${diagramKindsText()}.`,
      inputSchema: z.object({ kind: z.enum(DIAGRAM_KINDS) }),
      execute: async ({ kind }) => diagramGuide(kind),
    }),

    read_drawing: tool({
      description: `What is on one of a note's drawings (its links to ../attachments/<id>/<name>.excalidraw), as shapes: id, kind, place, size, text, colours, and the shapes each arrow joins; up to ${DRAWING_LIMITS.shown}. The drawing open in the editor is in the <screen> already, with any unsaved changes: read that instead.`,
      inputSchema: input,
      execute: async ({ path, name }) => {
        const found = await findDrawing(notes, path, name);
        if ("error" in found) return found;
        let shapes: Shape[];
        try { shapes = await shapesIn(notes.server, found.drawing); } catch (e) { return { error: `Couldn't read ${name}: ${(e as Error).message}` }; }
        const shown = shapes.slice(0, DRAWING_LIMITS.shown);
        return { path, name, shapes: shown, ...(shapes.length > shown.length ? { more: shapes.length - shown.length } : {}) };
      },
    }),

    show_drawing: tool({
      description: "Show the owner one of a note's drawings in the chat, as its saved picture; a tap opens it in the drawing editor. For \"show me the sketch\", or after a drawing was saved. Answer in a line after.",
      inputSchema: input,
      execute: async ({ path, name }): Promise<{ widget: DrawingWidget } | { error: string }> => {
        const found = await findDrawing(notes, path, name);
        return "error" in found ? found : { widget: { type: "drawing", path, title: found.title, name } };
      },
      toModelOutput: ({ output }) => ({ type: "json", value: "widget" in output ? { shown: "drawing", path: output.widget.path, name: output.widget.name } : output }),
    }),
  };
}
