import { describe, expect, it } from "bun:test";
import { landing, reorder } from "../src/task-order";

const list = (...orders: number[]) => orders.map((order, i) => ({ id: `t${i}`, order }));
const apply = (l: { id: string; order: number }[], w: { id: string; order: number }[]) =>
  l.map((t) => w.find((x) => x.id === t.id) ?? t).sort((a, b) => a.order - b.order).map((t) => t.id);

describe("reorder", () => {
  it("deals the same order values out again, writing only what moved", () => {
    const l = list(0, 1, 2);
    const w = reorder(l, 0, 2);
    expect(apply(l, w)).toEqual(["t1", "t2", "t0"]);
    expect(w).toHaveLength(3);
    expect(reorder(list(0, 5, 9), 2, 1)).toEqual([{ id: "t2", order: 5 }, { id: "t1", order: 9 }]);
  });
  it("keeps the values apart when the list held ties", () => {
    const l = list(0, 0, 0);
    const w = reorder(l, 2, 0);
    expect(apply(l, w)).toEqual(["t2", "t0", "t1"]);
    expect(new Set(l.map((t) => w.find((x) => x.id === t.id)?.order ?? t.order)).size).toBe(3);
  });
  it("does nothing for a drop where it was or outside the list", () => {
    expect(reorder(list(0, 1), 1, 1)).toEqual([]);
    expect(reorder(list(0, 1), 0, 5)).toEqual([]);
  });
});

describe("landing", () => {
  it("names the slot a drop before or after a neighbour leaves the row in", () => {
    expect(landing(0, 2, false)).toBe(1);   // a b c d: a before c -> b a c d
    expect(landing(0, 2, true)).toBe(2);    // a after c -> b c a d
    expect(landing(3, 1, false)).toBe(1);   // d before b -> a d b c
    expect(landing(3, 1, true)).toBe(2);    // d after b -> a b d c
    expect(landing(1, 1, false)).toBe(1);   // onto itself: no move
    expect(landing(1, 0, true)).toBe(1);    // right after its predecessor: no move
  });
});
