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

test("each boundary is checked independently, including each entry point", () => {
  const graph: Record<string, string[]> = { service: ["shared"], other: ["presenter"] };
  expect(violations([
    { ...rule, roots: ["service", "other"] },
    { name: "strict", roots: ["service"], forbidden: (name) => name === "shared" },
  ], (name) => graph[name] ?? [])).toEqual(["domain: other -> presenter", "strict: service -> shared"]);
});
