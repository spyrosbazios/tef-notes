import { expect, test } from "bun:test";
import { violations, type Boundary } from "./check-boundaries";

const rule: Boundary = { name: "domain", roots: ["service"], forbidden: (name) => name === "presenter" };

test("reports a forbidden dependency reached through another module", () => {
  const graph: Record<string, string[]> = { service: ["shared"], shared: ["presenter"] };
  expect(violations([rule], (name) => graph[name] ?? [])).toEqual(["domain: service -> shared -> presenter"]);
});

test("terminates cycles and permits shared dependencies without false violations", () => {
  const graph: Record<string, string[]> = { service: ["a", "b"], a: ["service", "shared"], b: ["shared"] };
  const visited: string[] = [];
  expect(violations([rule], (name) => { visited.push(name); return graph[name] ?? []; })).toEqual([]);
  expect(visited.filter((name) => name === "shared")).toHaveLength(1);
});

test("a direct boundary checks what a root imports itself, not what it reaches through the layer it must go through", () => {
  const graph: Record<string, string[]> = { component: ["hook"], hook: ["records"], records: ["copy"], shortcut: ["copy"] };
  const layer: Boundary = { name: "layer", roots: ["component", "shortcut"], forbidden: (name) => name === "copy", direct: true };
  expect(violations([layer], (name) => graph[name] ?? [])).toEqual(["layer: shortcut -> copy"]);
  expect(violations([{ ...layer, direct: false }], (name) => graph[name] ?? [])).toEqual(["layer: component -> hook -> records -> copy", "layer: shortcut -> copy"]);
});

test("each boundary is checked independently, including each entry point", () => {
  const graph: Record<string, string[]> = { service: ["shared"], other: ["presenter"] };
  expect(violations([
    { ...rule, roots: ["service", "other"] },
    { name: "strict", roots: ["service"], forbidden: (name) => name === "shared" },
  ], (name) => graph[name] ?? [])).toEqual(["domain: other -> presenter", "strict: service -> shared"]);
});
