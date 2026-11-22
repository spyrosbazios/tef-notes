import { describe, expect, it } from "bun:test";
import { versionInfoOf } from "@/core/release";
import { releases } from "../src/release";

const github = { tag_name: "v0.12.0", body: "## Added", html_url: "https://github.com/spyrosbazios/tef-notes/releases/tag/v0.12.0", draft: false };

function fake(updater: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const asked: string[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    asked.push(url);
    return url.startsWith("https://api.github.com/") ? Response.json(github) : updater(url, init);
  }) as typeof fetch;
  return { asked, f };
}

describe("release routes", () => {
  it("answers the running version, GitHub's newest (asked once) and the updater's status", async () => {
    const { asked, f } = fake(() => Response.json({ state: { phase: "idle", version: "", error: "" }, why: "" }));
    const r = releases({ running: "0.11.0", updater: "http://updater:8099", fetch: f, now: () => 0 });
    const info = versionInfoOf(await (await r.version()).json());
    expect(info.running).toBe("0.11.0");
    expect(info.latest?.version).toBe("0.12.0");
    expect(info.updater.state?.phase).toBe("idle");
    await r.version();
    expect(asked.filter((u) => u.includes("github")).length).toBe(1);
  });

  it("says how to turn the updater on when it isn't running", async () => {
    const { f } = fake(() => { throw new Error("ECONNREFUSED"); });
    const info = versionInfoOf(await (await releases({ running: "0.11.0", updater: "http://updater:8099", fetch: f, now: () => 0 }).version()).json());
    expect(info.updater.state).toBeNull();
    expect(info.updater.why).toContain("COMPOSE_PROFILES=updater");
  });

  it("passes only a version on, and the updater's answer back", async () => {
    let sent = "";
    const { f } = fake(async (_url, init) => { sent = String(init?.body); return new Response("Already updating to 0.12.0", { status: 409 }); });
    const r = releases({ running: "0.11.0", updater: "http://updater:8099", fetch: f, now: () => 0 });
    const req = (body: unknown) => new Request("http://x/agent/update", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
    expect((await r.update(req({ version: "nope" }))).status).toBe(400);
    const res = await r.update(req({ version: "v0.12.0", image: "evil/image" }));
    expect(res.status).toBe(409);
    expect(await res.text()).toBe("Already updating to 0.12.0");
    expect(JSON.parse(sent)).toEqual({ version: "0.12.0" });
  });
});
