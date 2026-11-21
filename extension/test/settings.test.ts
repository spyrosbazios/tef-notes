// The options page's address handling and what is kept in chrome.storage.sync.
import { beforeEach, describe, expect, it } from "bun:test";
import { getServer, getSummary, hasAccess, setServer, setSummary, toOrigin } from "../src/settings";
import { type FakeChrome, installChrome } from "./chrome";

describe("toOrigin", () => {
  it("keeps the scheme, host and port, and drops the path, query and a trailing slash", () => {
    expect(toOrigin("https://notes.example.net:8443")).toBe("https://notes.example.net:8443");
    expect(toOrigin("  http://100.64.0.1:8097/some/page?x=1#top \n")).toBe("http://100.64.0.1:8097");
    expect(toOrigin("https://Notes.Example.net/")).toBe("https://notes.example.net");
  });
  it("drops a port that is the scheme's own", () => {
    expect(toOrigin("https://notes.example.net:443")).toBe("https://notes.example.net");
  });
  it("says what is wrong with an address that is no address", () => {
    for (const bad of ["", "notes.example.net", "just words", "https://"]) expect(() => toOrigin(bad)).toThrow("Enter a full address, like https://host:port");
  });
  it("accepts http and https only", () => {
    for (const bad of ["ftp://host/", "file:///etc/passwd", "chrome://extensions", "javascript:alert(1)"]) expect(() => toOrigin(bad)).toThrow("must start with https:// or http://");
  });
});

describe("the server's address", () => {
  let fake: FakeChrome;
  beforeEach(() => { fake = installChrome(); });

  it("is unset until it is granted, and then it is kept with the access it was granted", async () => {
    expect(await getServer()).toBeUndefined();
    expect(await setServer("https://notes.example.net")).toBe(true);
    expect(fake.requests).toEqual([{ origins: ["https://notes.example.net/*"] }]);
    expect(await getServer()).toBe("https://notes.example.net");
    expect(await hasAccess("https://notes.example.net")).toBe(true);
    expect(await hasAccess("https://other.example.net")).toBe(false);
  });
  it("gives up the old address's access when it changes, and keeps it when the new one is declined", async () => {
    expect(await setServer("https://old.example.net")).toBe(true);
    expect(await setServer("https://old.example.net")).toBe(true);
    expect(await hasAccess("https://old.example.net")).toBe(true);
    fake.accepts = false;
    expect(await setServer("https://new.example.net")).toBe(false);
    expect(await hasAccess("https://old.example.net")).toBe(true);
    fake.accepts = true;
    expect(await setServer("https://new.example.net")).toBe(true);
    expect(await getServer()).toBe("https://new.example.net");
    expect(await hasAccess("https://new.example.net")).toBe(true);
    expect(await hasAccess("https://old.example.net")).toBe(false);
  });
  it("is not kept when the owner declines the permission", async () => {
    fake.accepts = false;
    expect(await setServer("https://notes.example.net")).toBe(false);
    expect(fake.sync.has("server")).toBe(false);
    expect(await getServer()).toBeUndefined();
  });
  it("reads only a non-empty string", async () => {
    for (const bad of ["", 7, null, { origin: "https://x" }]) {
      fake.sync.set("server", bad);
      expect(await getServer()).toBeUndefined();
    }
  });
});

describe("the summary box", () => {
  let fake: FakeChrome;
  beforeEach(() => { fake = installChrome(); });

  it("is off until it is ticked, then as it was left", async () => {
    expect(await getSummary()).toBe(false);
    await setSummary(true);
    expect(await getSummary()).toBe(true);
    await setSummary(false);
    expect(await getSummary()).toBe(false);
  });
  it("counts only a true boolean", async () => {
    fake.sync.set("summary", "true");
    expect(await getSummary()).toBe(false);
  });
});
