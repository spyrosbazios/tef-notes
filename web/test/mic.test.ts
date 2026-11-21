import { describe, expect, it } from "bun:test";
import { openWhileWanted, type Mic } from "../src/lib/mic";

const fake = () => {
  const mic: Mic & { closed: number } = { closed: 0, mute: () => {}, close: () => { mic.closed++; } };
  return mic;
};

describe("openWhileWanted", () => {
  it("hands the microphone over while it is still wanted", async () => {
    const mic = fake();
    expect(await openWhileWanted(async () => mic, () => true)).toBe(mic);
    expect(mic.closed).toBe(0);
  });
  it("closes it at once when the asker left while it opened", async () => {
    const mic = fake();
    let here = true;
    const opened = openWhileWanted(async () => { await Promise.resolve(); return mic; }, () => here);
    here = false;
    expect(await opened).toBeNull();
    expect(mic.closed).toBe(1);
  });
  it("passes a failure to open on", async () => {
    await expect(openWhileWanted(async () => { throw new Error("no mic"); }, () => true)).rejects.toThrow("no mic");
  });
});
