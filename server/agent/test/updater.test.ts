import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UpdateState } from "@/core/release";
import { BACKUPS, Updater, type Deps, type Ran } from "../src/updater/update";

const ok = (out = ""): Ran => ({ code: 0, out, err: "" });

type Call = { args: string[]; env: Record<string, string> };

/** A docker that answers like the published install: images pulled, pb_data a bind mount, pocketbase on 0.11.0. */
function fakeDocker(dir: string, over: Partial<Record<string, Ran>> = {}) {
  const calls: Call[] = [];
  const config = (v: string) => JSON.stringify({
    services: {
      pocketbase: { image: `ghcr.io/x/tef-notes:${v}`, volumes: [{ type: "bind", source: join(dir, "pb_data"), target: "/pb/pb_data" }] },
      agent: { image: `ghcr.io/x/tef-notes-agent:${v}` },
      updater: { image: `ghcr.io/x/tef-notes-updater:${v}` },
    },
  });
  const docker: Deps["docker"] = async (args, env = {}) => {
    calls.push({ args, env });
    const verb = args[0] === "compose" ? args[3] : args[0];
    if (over[verb]) return over[verb];
    if (verb === "config") return ok(config(env.TEF_NOTES_VERSION ?? "0.11.0"));
    if (verb === "ps") return ok("abc123\n");
    if (verb === "inspect") return ok(JSON.stringify({ "org.opencontainers.image.version": "0.11.0" }));
    return ok();
  };
  return { calls, docker };
}

async function settled(u: Updater): Promise<UpdateState> {
  for (let i = 0; i < 100; i++) {
    const s = u.current();
    if (s.phase === "failed" || s.phase === "restarting") return s;
    await Bun.sleep(1);
  }
  throw new Error("never settled");
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "updater-"));
  mkdirSync(join(dir, "pb_data"));
  writeFileSync(join(dir, "pb_data", "data.db"), "x");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const deps = (docker: Deps["docker"], over: Partial<Deps> = {}): Deps => ({
  docker,
  exec: async (cmd) => { writeFileSync(cmd[2], "tar"); return ok(); },
  published: async () => true,
  dir,
  now: () => new Date("2026-11-22T10:00:00Z"),
  backup: true,
  ...over,
});

describe("Updater", () => {
  it("pulls, backs up, pins .env, recreates the services on the version, then hands itself to its new image", async () => {
    writeFileSync(join(dir, ".env"), "TZ=Europe/Athens\nTEF_NOTES_VERSION=0.11.0\n");
    const { calls, docker } = fakeDocker(dir);
    const u = new Updater(deps(docker));
    expect("state" in u.start("v0.12.0")).toBe(true);
    const s = await settled(u);
    expect(s).toEqual({ phase: "restarting", version: "0.12.0", error: "" });
    await Bun.sleep(5);
    const verbs = calls.map((c) => (c.args[0] === "compose" ? c.args.slice(3).join(" ") : c.args[0]));
    expect(verbs).toEqual(["config --format json", "ps -q pocketbase", "inspect", "pull pocketbase agent updater", "stop agent pocketbase",
      "up -d pocketbase agent", "config --format json", "run"]);
    expect(calls.find((c) => c.args[3] === "pull")!.env.TEF_NOTES_VERSION).toBe("0.12.0");
    expect(calls.at(-1)!.args).toContain("ghcr.io/x/tef-notes-updater:0.12.0");
    expect(readFileSync(join(dir, ".env"), "utf8")).toBe("TZ=Europe/Athens\nTEF_NOTES_VERSION=0.12.0\n");
    expect(readdirSync(join(dir, "backups"))).toEqual(["pb_data-2026-11-22T10-00-00-000Z-v0.11.0.tar.gz"]);
  });

  it("leaves an unpinned .env on latest", async () => {
    writeFileSync(join(dir, ".env"), "TZ=UTC\n");
    const u = new Updater(deps(fakeDocker(dir).docker));
    u.start("0.12.0");
    await settled(u);
    expect(readFileSync(join(dir, ".env"), "utf8")).toBe("TZ=UTC\n");
  });

  it("refuses an older version, an unpublished one and a second update at once", async () => {
    const u = new Updater(deps(fakeDocker(dir).docker));
    u.start("0.10.0");
    expect((await settled(u)).error).toContain("not newer");
    const v = new Updater(deps(fakeDocker(dir).docker, { published: async () => false }));
    v.start("0.12.0");
    expect((await settled(v)).error).toContain("not a published release");
    const w = new Updater(deps(fakeDocker(dir).docker));
    w.start("0.12.0");
    expect(w.start("0.12.0")).toEqual({ refused: "Already updating to 0.12.0" });
    expect(w.start("latest; rm -rf /")).toEqual({ refused: "Not a release version" });
  });

  it("won't update a source build", async () => {
    const { docker } = fakeDocker(dir, { config: ok(JSON.stringify({ services: { pocketbase: { build: {} }, agent: {}, updater: {} } })) });
    const u = new Updater(deps(docker));
    expect((await u.status()).why).toContain("built from source");
    u.start("0.12.0");
    expect((await settled(u)).error).toContain("built from source");
  });

  it("changes nothing when the pull fails", async () => {
    const { calls, docker } = fakeDocker(dir, { pull: { code: 1, out: "", err: "manifest unknown" } });
    const u = new Updater(deps(docker));
    u.start("0.12.0");
    expect((await settled(u)).error).toBe("Pulling the images failed; nothing was changed: manifest unknown");
    expect(calls.some((c) => c.args.includes("stop"))).toBe(false);
  });

  it("starts the server again when the backup fails", async () => {
    const { calls, docker } = fakeDocker(dir);
    const u = new Updater(deps(docker, { exec: async () => ({ code: 2, out: "", err: "No space left on device" }) }));
    u.start("0.12.0");
    const s = await settled(u);
    expect(s.error).toBe("Backing up pb_data failed: No space left on device; the server was started again as it was");
    const last = calls.at(-1)!;
    expect(last.args.slice(3)).toEqual(["up", "-d", "pocketbase", "agent"]);
    expect(last.env.TEF_NOTES_VERSION).toBeUndefined();
  });

  it(`keeps the newest ${BACKUPS} backups`, async () => {
    mkdirSync(join(dir, "backups"));
    for (const d of ["2026-01", "2026-02", "2026-03"]) writeFileSync(join(dir, "backups", `pb_data-${d}-v0.1.0.tar.gz`), "");
    const u = new Updater(deps(fakeDocker(dir).docker));
    u.start("0.12.0");
    await settled(u);
    expect(readdirSync(join(dir, "backups")).sort()).toEqual(["pb_data-2026-02-v0.1.0.tar.gz", "pb_data-2026-03-v0.1.0.tar.gz", "pb_data-2026-11-22T10-00-00-000Z-v0.11.0.tar.gz"]);
  });
});
