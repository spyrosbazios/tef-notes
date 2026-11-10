import { expect, test } from "bun:test";
import { DIAGRAM_KINDS, diagramGuide, diagramKindsText } from "../src/diagram-guides";
import { DRAW_COLOR_NAMES } from "../src/drawing";

test("every kind has a recipe, and the description lists them all", () => {
  for (const k of DIAGRAM_KINDS) expect(diagramGuide(k).steps.length).toBeGreaterThan(2);
  for (const k of DIAGRAM_KINDS) expect(diagramKindsText()).toContain(k);
});

test("recipes name only colours the draw tool has", () => {
  const off = ["purple", "grey", "white", "brown", "cyan", "indigo", "lime"];
  const text = DIAGRAM_KINDS.flatMap((k) => [...diagramGuide(k).steps, ...diagramGuide(k).always]).join(" ").toLowerCase();
  for (const c of off) expect(text).not.toMatch(new RegExp(`\\b${c}\\b`));
  for (const c of ["blue", "yellow", "gray", "violet", "green", "red", "orange"]) expect(DRAW_COLOR_NAMES).toContain(c as never);
});
