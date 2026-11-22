// Updates from the app: which release the server runs, which is the newest published, and the updater's progress. The
// contract between the agent (server/agent/src/release.ts), the updater (server/agent/src/updater/) and the web app's
// Settings → Maintenance. Pure types, readers and the version order, no I/O. Routes (under the agent, no sign-in like the rest):
//   GET  /agent/version  -> VersionInfo
//   POST /agent/update   UpdateBody -> UpdateState (202), or 409 with the reason as text; the agent hands it to the updater
// The updater is an opt-in compose service (profile `updater`): the one container holding the Docker socket, it pulls the
// release's images, snapshots pb_data and recreates the containers (server/README.md "Updating from the app").

/** Where releases are published: GitHub's releases of this repository, whose tags vX.Y.Z name the images' tags. */
export const RELEASES_REPO = "spyrosbazios/tef-notes";

/** A published release: its version (no `v`), its notes (Markdown, the changelog's section) and its page. */
export type Release = { version: string; notes: string; url: string };

/** Where an update stands. `idle`: none ran since the updater started. `failed`: `error` says why, and what was left as it was. */
export type UpdatePhase = "idle" | "checking" | "pulling" | "backing-up" | "restarting" | "failed";
export type UpdateState = { phase: UpdatePhase; version: string; error: string };

/** The updater's `GET /status`, and the agent's copy of it. `why` is non-empty when the app can't update this install: the
 *  updater isn't running (`state` null; it is opt-in) or it runs but won't (built from source). */
export type UpdaterStatus = { state: UpdateState | null; why: string };

/** `GET /agent/version`. `running`: "" when the image carries no version (a local build without one). `latest`: null when
 *  GitHub couldn't be asked. */
export type VersionInfo = { running: string; latest: Release | null; updater: UpdaterStatus };

/** The body of `POST /agent/update`: the version to move to, which must be a published release newer than the running one. */
export type UpdateBody = { version: string };

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** A release version, `X.Y.Z` or `X.Y.Z-pre`, without a leading `v`; anything else is "". */
export function versionOf(v: unknown): string {
  const s = typeof v === "string" ? v.trim().replace(/^v/, "") : "";
  return VERSION.test(s) ? s : "";
}

/** Whether release `a` is newer than `b` (semver order; a pre-release is older than its release). Not a version: never newer. */
export function newer(a: string, b: string): boolean {
  const x = VERSION.exec(a), y = VERSION.exec(b);
  if (!x) return false;
  if (!y) return false;
  for (let i = 1; i <= 3; i++) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) > Number(y[i]);
  const p = x[4] ?? "", q = y[4] ?? "";
  if (p === q) return false;
  if (!p) return true;
  if (!q) return false;
  return p.localeCompare(q, "en", { numeric: true }) > 0;
}

/** Whether `info` offers an update: a known running version and a newer published one. */
export const updateOffered = (info: VersionInfo): boolean =>
  !!info.latest && !!info.running && newer(info.latest.version, info.running);

/** Whether the updater is in the middle of an update. */
export const updating = (s: UpdateState | null): boolean =>
  !!s && s.phase !== "idle" && s.phase !== "failed";

const PHASES: readonly UpdatePhase[] = ["idle", "checking", "pulling", "backing-up", "restarting", "failed"];
const str = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const NOTES_MAX = 20_000;

/** GitHub's `releases/latest` answer as a Release, or null: a draft, a tag that isn't a version, a page off GitHub. */
export function githubReleaseOf(v: unknown): Release | null {
  const r = obj(v);
  const version = versionOf(r.tag_name), url = str(r.html_url);
  if (!version || r.draft === true || !url.startsWith("https://github.com/")) return null;
  return { version, notes: str(r.body).slice(0, NOTES_MAX), url };
}

/** An UpdateState, read defensively. */
export function updateStateOf(v: unknown): UpdateState | null {
  const r = obj(v);
  const phase = PHASES.find((p) => p === r.phase);
  return phase ? { phase, version: versionOf(r.version), error: str(r.error) } : null;
}

/** An UpdaterStatus, read defensively. */
export function updaterStatusOf(v: unknown): UpdaterStatus {
  const u = obj(v);
  return { state: updateStateOf(u.state), why: str(u.why) };
}

/** `GET /agent/version`, read defensively. */
export function versionInfoOf(v: unknown): VersionInfo {
  const r = obj(v), l = obj(r.latest);
  const latest = versionOf(l.version) ? { version: versionOf(l.version), notes: str(l.notes), url: str(l.url) } : null;
  return { running: versionOf(r.running), latest, updater: updaterStatusOf(r.updater) };
}
