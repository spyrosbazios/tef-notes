import { describe, expect, it } from "bun:test";
import { TICK_MS, ticker, type Clock } from "../src/tick";

/** A clock the test winds by hand. */
function fake() {
  let now = 0, next = 0;
  const due = new Map<number, { at: number; f: () => void }>();
  const clock: Clock = {
    set: (f, ms) => { due.set(++next, { at: now + ms, f }); return next; },
    clear: (h) => { due.delete(h as number); },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [h, t] of [...due]) if (t.at <= now) { due.delete(h); t.f(); }
  };
  return { clock, advance };
}

describe("ticker", () => {
  it("settles a tick once its wait has run out, not before", () => {
    const { clock, advance } = fake(), settled: string[] = [];
    const t = ticker((id) => settled.push(id), TICK_MS, clock);
    expect(t.toggle("a")).toBe("waiting");
    advance(TICK_MS - 1);
    expect(settled).toEqual([]);
    expect(t.has("a")).toBe(true);
    advance(1);
    expect(settled).toEqual(["a"]);
    expect(t.has("a")).toBe(false);
  });

  it("takes a tick back with a second tap inside the wait: nothing is written", () => {
    const { clock, advance } = fake(), settled: string[] = [];
    const t = ticker((id) => settled.push(id), TICK_MS, clock);
    t.toggle("a");
    advance(500);
    expect(t.toggle("a")).toBe("taken-back");
    advance(5000);
    expect(settled).toEqual([]);
    expect(t.has("a")).toBe(false);
    // and a fresh tick afterwards waits again from its own start
    expect(t.toggle("a")).toBe("waiting");
    advance(TICK_MS);
    expect(settled).toEqual(["a"]);
  });

  it("keeps each task's wait to itself", () => {
    const { clock, advance } = fake(), settled: string[] = [];
    const t = ticker((id) => settled.push(id), TICK_MS, clock);
    t.toggle("a");
    advance(1000);
    t.toggle("b");
    advance(500);
    expect(settled).toEqual(["a"]);
    t.cancel("b");
    advance(5000);
    expect(settled).toEqual(["a"]);
  });

  it("cancel says whether there was a wait to cancel", () => {
    const { clock } = fake();
    const t = ticker(() => {}, TICK_MS, clock);
    expect(t.cancel("a")).toBe(false);
    t.toggle("a");
    expect(t.cancel("a")).toBe(true);
    expect(t.cancel("a")).toBe(false);
  });

  it("flush settles everything waiting at once, and only once", () => {
    const { clock, advance } = fake(), settled: string[] = [];
    const t = ticker((id) => settled.push(id), TICK_MS, clock);
    t.toggle("a"); t.toggle("b");
    t.flush();
    expect(settled.sort()).toEqual(["a", "b"]);
    advance(10_000);
    expect(settled).toHaveLength(2);
    expect(t.has("a")).toBe(false);
  });
});
