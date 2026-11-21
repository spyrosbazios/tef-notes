// The editor reads its body out once per burst of typing, and at once when something is about to read it.
import { describe, expect, test } from "bun:test";
import { pending } from "../src/editor/pending";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("pending", () => {
  test("many pokes in one wait run once, when the wait ends", async () => {
    let n = 0;
    const p = pending(() => { n++; }, 20);
    for (let i = 0; i < 50; i++) p.poke();
    expect(n).toBe(0);
    await tick(40);
    expect(n).toBe(1);
  });
  test("flush runs what waits now, and the wait does not run it again", async () => {
    let n = 0;
    const p = pending(() => { n++; }, 20);
    p.poke(); p.poke();
    p.flush();
    expect(n).toBe(1);
    await tick(40);
    expect(n).toBe(1);
  });
  test("flush with nothing waiting does nothing", () => {
    let n = 0;
    pending(() => { n++; }, 20).flush();
    expect(n).toBe(0);
  });
  test("a poke after a run starts a new wait", async () => {
    let n = 0;
    const p = pending(() => { n++; }, 10);
    p.poke(); await tick(30); p.poke(); await tick(30);
    expect(n).toBe(2);
  });
});
