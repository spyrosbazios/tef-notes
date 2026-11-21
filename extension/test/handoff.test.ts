// The context menu's page, carried to the choice window through chrome.storage.session: taken once, then gone.
import { beforeEach, describe, expect, it } from "bun:test";
import { stash, take } from "../src/handoff";
import { type FakeChrome, installChrome } from "./chrome";

describe("the handoff", () => {
  let fake: FakeChrome;
  beforeEach(() => { fake = installChrome(); });

  it("gives the page back once, and the session area keeps nothing of it", async () => {
    const page = { url: "https://example.com/a", title: "A", selection: "words" };
    const id = await stash({ page });
    expect(await take(id)).toEqual({ page });
    expect(await take(id)).toBeUndefined();
    expect(fake.session.size).toBe(0);
  });
  it("carries why there is no page", async () => {
    const id = await stash({ error: "This page can't be saved." });
    expect(await take(id)).toEqual({ error: "This page can't be saved." });
  });
  it("keeps two handoffs apart", async () => {
    const a = await stash({ error: "a" }), b = await stash({ error: "b" });
    expect(a).not.toBe(b);
    expect(await take(b)).toEqual({ error: "b" });
    expect(await take(a)).toEqual({ error: "a" });
  });
  it("knows nothing of an id it was not given", async () => {
    expect(await take("00000000-0000-0000-0000-000000000000")).toBeUndefined();
  });
});
