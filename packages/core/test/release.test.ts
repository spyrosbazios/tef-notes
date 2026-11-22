import { describe, expect, it } from "bun:test";
import { githubReleaseOf, newer, updateOffered, updateStateOf, updating, versionInfoOf, versionOf } from "../src/release";

describe("versionOf", () => {
  it("takes X.Y.Z with or without a v, and a pre-release", () => {
    expect(versionOf("v0.12.0")).toBe("0.12.0");
    expect(versionOf("1.2.3-rc.1")).toBe("1.2.3-rc.1");
    for (const bad of ["", "latest", "1.2", "v1.2.3.4", "1.2.3 && rm", "../1.2.3", 3, null]) expect(versionOf(bad)).toBe("");
  });
});

describe("newer", () => {
  it("orders by number, not by text", () => {
    expect(newer("0.10.0", "0.9.9")).toBe(true);
    expect(newer("0.9.9", "0.10.0")).toBe(false);
    expect(newer("1.0.0", "1.0.0")).toBe(false);
  });
  it("puts a pre-release before its release", () => {
    expect(newer("1.0.0", "1.0.0-rc.1")).toBe(true);
    expect(newer("1.0.0-rc.2", "1.0.0")).toBe(false);
    expect(newer("1.0.0-rc.10", "1.0.0-rc.9")).toBe(true);
  });
  it("is never true for something that isn't a version", () => {
    expect(newer("latest", "1.0.0")).toBe(false);
    expect(newer("1.0.0", "")).toBe(false);
  });
});

describe("readers", () => {
  it("reads GitHub's release and drops drafts and foreign pages", () => {
    const r = { tag_name: "v0.12.0", body: "## Added", html_url: "https://github.com/x/y/releases/tag/v0.12.0", draft: false };
    expect(githubReleaseOf(r)).toEqual({ version: "0.12.0", notes: "## Added", url: r.html_url });
    expect(githubReleaseOf({ ...r, draft: true })).toBeNull();
    expect(githubReleaseOf({ ...r, html_url: "https://evil.example/" })).toBeNull();
    expect(githubReleaseOf({ ...r, tag_name: "nightly" })).toBeNull();
  });
  it("offers an update only from a known version to a newer one", () => {
    const latest = { version: "0.12.0", notes: "", url: "" };
    const updater = { state: null, why: "" };
    expect(updateOffered({ running: "0.11.0", latest, updater })).toBe(true);
    expect(updateOffered({ running: "0.12.0", latest, updater })).toBe(false);
    expect(updateOffered({ running: "", latest, updater })).toBe(false);
    expect(updateOffered({ running: "0.11.0", latest: null, updater })).toBe(false);
  });
  it("reads the agent's answer defensively", () => {
    expect(versionInfoOf(null)).toEqual({ running: "", latest: null, updater: { state: null, why: "" } });
    const info = versionInfoOf({ running: "0.11.0", latest: { version: "0.12.0", notes: "n", url: "u" }, updater: { state: { phase: "pulling", version: "0.12.0", error: "" }, why: "" } });
    expect(info.updater.state?.phase).toBe("pulling");
    expect(updating(info.updater.state)).toBe(true);
    expect(updateStateOf({ phase: "exploding" })).toBeNull();
    expect(updating({ phase: "failed", version: "", error: "x" })).toBe(false);
  });
});
