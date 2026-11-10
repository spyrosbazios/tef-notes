import { describe, expect, test } from "bun:test";
import { contextOf, uiToolsFor } from "../src/assistant";
import { DRAW_COLORS, DRAWING_LIMITS, editProblem, editWords, shapesOf } from "../src/drawing";
import { widgetOf } from "../src/widgets";

// A scene as Excalidraw saves it, cut to the fields shapesOf reads
const scene = [
  { id: "api", type: "rectangle", x: 10.4, y: 20, width: 160, height: 80, strokeColor: DRAW_COLORS.blue.stroke, backgroundColor: DRAW_COLORS.blue.fill, boundElements: [{ id: "t1", type: "text" }] },
  { id: "t1", type: "text", x: 40, y: 50, width: 30, height: 25, text: "API", originalText: "API", containerId: "api", fontSize: 20, strokeColor: "#1e1e1e" },
  { id: "db", type: "ellipse", x: 300, y: 20, width: 120, height: 80, strokeColor: "#1e1e1e", backgroundColor: "transparent", strokeStyle: "dashed" },
  { id: "a1", type: "arrow", x: 178, y: 60, width: 114, height: 0, points: [[0, 0], [114, 0]], startBinding: { elementId: "api" }, endBinding: { elementId: "db" }, strokeColor: "#1e1e1e" },
  { id: "note", type: "text", x: 10, y: 140, width: 200, height: 40, text: "wrapped\nline", originalText: "wrapped line", fontSize: 28, strokeColor: "#1e1e1e" },
  { id: "pen", type: "freedraw", x: 0, y: 200, width: 50, height: 20, strokeColor: "#123456" },
  { id: "gone", type: "rectangle", x: 0, y: 0, width: 5, height: 5, isDeleted: true },
  { id: "odd", type: "selection", x: 0, y: 0, width: 5, height: 5 },
];

describe("a scene as shapes", () => {
  test("boxes carry their label and colours, arrows the shapes they join, texts their unwrapped words", () => {
    expect(shapesOf(scene)).toEqual([
      { id: "api", type: "rectangle", x: 10, y: 20, w: 160, h: 80, text: "API", stroke: "blue", fill: "blue" },
      { id: "db", type: "ellipse", x: 300, y: 20, w: 120, h: 80, dashed: true },
      { id: "a1", type: "arrow", x: 178, y: 60, w: 114, h: 0, from: "api", to: "db" },
      { id: "note", type: "text", x: 10, y: 140, w: 200, h: 40, text: "wrapped line", size: "l" },
      { id: "pen", type: "freedraw", x: 0, y: 200, w: 50, h: 20 },
    ]);
  });

  test("anything that isn't a scene is no shapes", () => {
    expect(shapesOf(null)).toEqual([]);
    expect(shapesOf([1, "x", { type: "rectangle" }])).toEqual([]);
  });
});

describe("an edit", () => {
  const shapes = shapesOf(scene);
  const box = { type: "rectangle" as const, x: 0, y: 0, w: 100, h: 50 };

  test("adds boxes and an arrow joining a new one to one there is", () => {
    expect(editProblem({ add: [{ id: "q", ...box }, { id: "a2", type: "arrow", from: "q", to: "db" }] }, shapes)).toBeNull();
  });

  test("changes and removes what is there", () => {
    expect(editProblem({ update: [{ id: "api", x: 40, text: "Gateway" }], remove: ["pen"] }, shapes)).toBeNull();
    expect(editProblem({}, shapes)).toBeNull();
  });

  test("refuses ids taken, missing or malformed", () => {
    expect(editProblem({ add: [{ id: "api", ...box }] }, shapes)).toMatch(/taken/);
    expect(editProblem({ add: [{ id: "x", ...box }, { id: "x", ...box }] }, shapes)).toMatch(/taken/);
    expect(editProblem({ add: [{ id: "a b", ...box }] }, shapes)).toMatch(/usable id/);
    expect(editProblem({ update: [{ id: "nope", x: 1 }] }, shapes)).toMatch(/No shape/);
    expect(editProblem({ remove: ["nope"] }, shapes)).toMatch(/No shape/);
    expect(editProblem({ update: [{ id: "pen", x: 1 }], remove: ["pen"] }, shapes)).toMatch(/No shape/);
  });

  test("an arrow joins shapes there are, never a line, and a line joins nothing", () => {
    expect(editProblem({ add: [{ id: "a2", type: "arrow", from: "api", to: "nope" }] }, shapes)).toMatch(/isn't in the drawing/);
    expect(editProblem({ add: [{ id: "a2", type: "arrow", from: "api", to: "a1" }] }, shapes)).toMatch(/a line/);
    expect(editProblem({ add: [{ id: "a2", type: "arrow", from: "api", to: "db" }], remove: ["db"] }, shapes)).toMatch(/isn't in the drawing/);
    expect(editProblem({ add: [{ id: "l", type: "line", from: "api", to: "db" }] }, shapes)).toMatch(/only an arrow/);
    expect(editProblem({ add: [{ id: "l", type: "line", x: 0, y: 0, w: -40, h: 10 }] }, shapes)).toBeNull();
    expect(editProblem({ add: [{ id: "a2", type: "arrow", from: "api" }] }, shapes)).toMatch(/both ends/);
  });

  test("a box needs its place and a size, a text its words, all within bounds", () => {
    expect(editProblem({ add: [{ id: "q", type: "rectangle", x: 0, y: 0 }] }, shapes)).toMatch(/positive w and h/);
    expect(editProblem({ add: [{ id: "q", ...box, w: 0 }] }, shapes)).toMatch(/positive w and h/);
    expect(editProblem({ add: [{ id: "t", type: "text", x: 0, y: 0, text: " " }] }, shapes)).toMatch(/its text/);
    expect(editProblem({ add: [{ id: "q", ...box, x: DRAWING_LIMITS.coord + 1 }] }, shapes)).toMatch(/positive w and h/);
    expect(editProblem({ update: [{ id: "api", x: Number.NaN }] }, shapes)).toMatch(/within/);
    expect(editProblem({ add: Array.from({ length: DRAWING_LIMITS.add + 1 }, (_, i) => ({ id: `b${i}`, ...box })) }, shapes)).toMatch(/split it/);
  });

  test("in a line for the chat", () => {
    expect(editWords({ add: [{ id: "q", ...box }], update: [{ id: "api" }, { id: "db" }] })).toBe("Added 1 shape, changed 2 shapes");
    expect(editWords({})).toBe("Opened it");
  });
});

describe("the drawing on screen", () => {
  const view = { kind: "home" };

  test("read from a context, its shapes checked and bounded, the selection only of shapes it has", () => {
    const many = Array.from({ length: DRAWING_LIMITS.shown + 3 }, (_, i) => ({ id: `s${i}`, type: "rectangle", x: i, y: 0, w: 10, h: 10 }));
    const c = contextOf({ view, drawing: { path: "notes/garage.md", name: "plan.excalidraw", shapes: [{ id: "bad id", type: "rectangle" }, ...many], selected: ["s1", "nope"], unsaved: true } });
    expect(c?.drawing?.name).toBe("plan.excalidraw");
    expect(c?.drawing?.shapes).toHaveLength(DRAWING_LIMITS.shown);
    expect(c?.drawing?.more).toBe(3);
    expect(c?.drawing?.selected).toEqual(["s1"]);
    expect(c?.drawing?.unsaved).toBe(true);
  });

  test("a bad note or file name is no drawing, or no name", () => {
    expect(contextOf({ view, drawing: { path: "../x", shapes: [] } })?.drawing).toBeUndefined();
    expect(contextOf({ view, drawing: { path: "notes/a.md", name: "../b.excalidraw", shapes: [] } })?.drawing).toEqual({ path: "notes/a.md", shapes: [] });
  });

  test("draw is offered with a context, as the app's other tools are", () => {
    expect(uiToolsFor({ view: { kind: "home" } })).toContain("draw");
    expect(uiToolsFor({ view: { kind: "home" } })).toContain("save_drawing");
    expect(uiToolsFor(undefined)).not.toContain("draw");
  });
});

describe("the drawing widget", () => {
  test("reads a note's drawing, nothing else", () => {
    expect(widgetOf({ widget: { type: "drawing", path: "notes/a.md", title: "A", name: "d.excalidraw" } })).toEqual({ type: "drawing", path: "notes/a.md", title: "A", name: "d.excalidraw" });
    expect(widgetOf({ widget: { type: "drawing", path: "notes/a.md", title: "A", name: "d.png" } })).toBeNull();
    expect(widgetOf({ widget: { type: "drawing", path: "x", title: "A", name: "d.excalidraw" } })).toBeNull();
  });
});
