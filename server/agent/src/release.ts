// Updates from the app (contract: core/release.ts): the release this server runs, the newest on GitHub, and the updater beside
// it. The agent asks GitHub (cached, so the app's checks cost one request in CHECK_MS) and passes an update on to the updater,
// which alone holds the Docker socket and does its own checks (updater/update.ts): nothing here can name an image or a command.
import { githubReleaseOf, updaterStatusOf, versionOf, RELEASES_REPO, type Release, type UpdaterStatus, type VersionInfo } from "@/core/release";

/** How long GitHub's answer is kept. */
const CHECK_MS = 6 * 60 * 60_000;

export type ReleaseDeps = {
  /** The image's own release, baked in by the Dockerfile's build argument (TEF_NOTES_IMAGE_VERSION); "" for a build without one. */
  running: string;
  updater: string;
  fetch: typeof fetch;
  now: () => number;
};

const OFF = "Updating from the app is off. Turn it on with COMPOSE_PROFILES=updater in server/.env, then docker compose up -d (server/README.md, Updating from the app).";

export function releases(d: ReleaseDeps) {
  let cached: { at: number; release: Release | null } | null = null;

  async function latest(): Promise<Release | null> {
    if (cached && d.now() - cached.at < CHECK_MS) return cached.release;
    const release = await d.fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
      headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10_000),
    }).then((r) => (r.ok ? r.json() : null)).then(githubReleaseOf).catch(() => null);
    // A failed check is kept too, for a tenth as long, so an offline server doesn't ask on every visit
    cached = { at: release ? d.now() : d.now() - CHECK_MS * 0.9, release };
    return release;
  }

  async function updater(): Promise<UpdaterStatus> {
    try {
      const r = await d.fetch(`${d.updater}/status`, { signal: AbortSignal.timeout(5_000) });
      return r.ok ? updaterStatusOf(await r.json()) : { state: null, why: OFF };
    } catch {
      return { state: null, why: OFF };
    }
  }

  return {
    /** `GET /agent/version`. */
    async version(): Promise<Response> {
      const [release, status] = await Promise.all([latest(), updater()]);
      return Response.json({ running: d.running, latest: release, updater: status } satisfies VersionInfo);
    },
    /** `POST /agent/update`: the version alone is passed on; the updater answers. */
    async update(req: Request): Promise<Response> {
      const body = (await req.json().catch(() => null)) as { version?: unknown } | null;
      const version = versionOf(body?.version);
      if (!version) return new Response("Not a release version", { status: 400 });
      try {
        const r = await d.fetch(`${d.updater}/update`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version }), signal: AbortSignal.timeout(10_000),
        });
        return new Response(await r.text(), { status: r.status, headers: { "content-type": r.headers.get("content-type") ?? "text/plain" } });
      } catch {
        return new Response(OFF, { status: 409 });
      }
    },
  };
}
