// The updater's one job: move this install to a newer published release. It is the only container holding the Docker
// socket, which is root on the host, so it takes one input, a version, and does one fixed thing with it:
//   1. checking    the version is a published release (GitHub), newer than the one running, and this install pulls images
//                  (one built from source updates with git, server/README.md)
//   2. pulling     the release's three images; a failure here changes nothing
//   3. backing-up  PocketBase stopped, pb_data tarred into backups/ (the newest BACKUPS kept); a failure starts it again as it was
//   4. restarting  a pinned TEF_NOTES_VERSION in .env moved to the version, pocketbase and agent recreated on it (migrations
//                  apply on start), then a one-off container of the new updater image recreates this one, which can't
//                  replace itself
// The compose project is mounted at its host path (docker-compose.yml), so compose here resolves ./pb_data and the key
// mounts to the same host paths the owner's own `docker compose` does.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { newer, versionOf, type UpdateState, type UpdaterStatus } from "@/core/release";

/** One command's outcome. */
export type Ran = { code: number; out: string; err: string };
/** Runs `docker <args>` with `env` added to the updater's own environment. */
export type Docker = (args: string[], env?: Record<string, string>) => Promise<Ran>;
/** Runs any other program (tar). */
export type Exec = (cmd: string[]) => Promise<Ran>;

export type Deps = {
  docker: Docker;
  exec: Exec;
  /** Whether `version` is a published, non-draft release. */
  published: (version: string) => Promise<boolean>;
  /** The compose project's directory, the same path inside and outside the container. */
  dir: string;
  now: () => Date;
  /** False: no pb_data snapshot (TEF_NOTES_UPDATE_BACKUP=off). */
  backup: boolean;
};

/** How many pb_data snapshots backups/ keeps. */
export const BACKUPS = 3;
/** The image label that names a container's release (docker/metadata-action sets it on the published images). */
const VERSION_LABEL = "org.opencontainers.image.version";
const PROFILE = ["compose", "--profile", "updater"];
const SERVICES = ["pocketbase", "agent"];
const SOCKET = "/var/run/docker.sock";

type Service = { image?: string; build?: unknown; volumes?: { type?: string; source?: string; target?: string }[] };
type Config = { services?: Record<string, Service> };

class Failed extends Error {}

/** The last lines of a command's output, for an error the owner reads. */
const tail = (r: Ran) => (r.err || r.out).trim().split("\n").slice(-4).join("\n");

export class Updater {
  private state: UpdateState = { phase: "idle", version: "", error: "" };
  constructor(private readonly d: Deps) {}

  /** Where an update stands. */
  current(): UpdateState {
    return this.state;
  }

  /** What the app shows: where an update stands, and why it can't run here, if it can't. */
  async status(): Promise<UpdaterStatus> {
    try {
      return { state: this.state, why: this.blocked(await this.config()) };
    } catch (e) {
      return { state: this.state, why: (e as Error).message };
    }
  }

  /** Starts an update to `version` and returns at once, or the reason it can't start. */
  start(version: unknown): { state: UpdateState } | { refused: string } {
    const v = versionOf(version);
    if (!v) return { refused: "Not a release version" };
    if (this.state.phase !== "idle" && this.state.phase !== "failed") return { refused: `Already updating to ${this.state.version}` };
    this.state = { phase: "checking", version: v, error: "" };
    void this.run(v).catch((e: unknown) => {
      this.state = { ...this.state, phase: "failed", error: (e as Error).message };
    });
    return { state: this.state };
  }

  private async run(v: string): Promise<void> {
    const at = { TEF_NOTES_VERSION: v };
    const config = await this.config();
    const why = this.blocked(config);
    if (why) throw new Failed(why);
    const running = await this.running();
    if (running && !newer(v, running)) throw new Failed(`${v} is not newer than the running ${running}`);
    if (!(await this.d.published(v))) throw new Failed(`${v} is not a published release`);

    this.state = { ...this.state, phase: "pulling" };
    await this.compose(["pull", ...SERVICES, "updater"], at, "Pulling the images failed; nothing was changed");

    if (this.d.backup) {
      this.state = { ...this.state, phase: "backing-up" };
      const data = pbData(config);
      await this.compose(["stop", "agent", "pocketbase"], {}, "Stopping the server for the backup failed");
      try {
        await this.snapshot(data, running);
      } catch (e) {
        await this.d.docker([...PROFILE, "up", "-d", ...SERVICES]);
        throw new Failed(`${(e as Error).message}; the server was started again as it was`);
      }
    }

    this.state = { ...this.state, phase: "restarting" };
    this.pin(v);
    await this.compose(["up", "-d", ...SERVICES], at, "Starting the new version failed");
    const self = (await this.config(at)).services?.updater?.image;
    if (!self) throw new Failed("The server is updated; the updater's own image wasn't found, so it stays on the old version");
    // A one-off container of the new image recreates this one, which can't recreate itself: its compose would be killed halfway
    const r = await this.d.docker(["run", "-d", "--rm", "-v", `${SOCKET}:${SOCKET}`, "-v", `${this.d.dir}:${this.d.dir}`, "-w", this.d.dir,
      "-e", `PWD=${this.d.dir}`, "-e", `TEF_NOTES_VERSION=${v}`, "--entrypoint", "docker", self, ...PROFILE, "up", "-d", "--no-deps", "updater"]);
    if (r.code !== 0) throw new Failed(`The server is updated; recreating the updater failed: ${tail(r)}`);
  }

  /** Why this install can't be updated from the app, or "". */
  private blocked(c: Config): string {
    const s = c.services ?? {};
    if (SERVICES.some((n) => s[n]?.build)) return "This server is built from source: update it with git pull and docker compose up -d --build";
    if (!s.updater) return "The updater isn't in this compose project";
    if (this.d.backup && !bindOf(c)) return "pb_data isn't a folder on the host, so it can't be backed up first: back it up yourself and set TEF_NOTES_UPDATE_BACKUP=off";
    return "";
  }

  private async config(env: Record<string, string> = {}): Promise<Config> {
    const r = await this.d.docker([...PROFILE, "config", "--format", "json"], env);
    if (r.code !== 0) throw new Failed(`Reading the compose project failed: ${tail(r)}`);
    return JSON.parse(r.out) as Config;
  }

  /** The release the running PocketBase container was built from, by its image's label; "" when it carries none. */
  private async running(): Promise<string> {
    const id = (await this.d.docker([...PROFILE, "ps", "-q", "pocketbase"])).out.trim().split("\n")[0];
    if (!id) return "";
    const r = await this.d.docker(["inspect", "--format", "{{json .Config.Labels}}", id]);
    try {
      return versionOf((JSON.parse(r.out) as Record<string, string>)[VERSION_LABEL]);
    } catch {
      return "";
    }
  }

  private async compose(args: string[], env: Record<string, string>, failure: string): Promise<void> {
    const r = await this.d.docker([...PROFILE, ...args], env);
    if (r.code !== 0) throw new Failed(`${failure}: ${tail(r)}`);
  }

  /** pb_data tarred into backups/, the oldest beyond BACKUPS removed. */
  private async snapshot(data: string, from: string): Promise<void> {
    const dir = join(this.d.dir, "backups");
    mkdirSync(dir, { recursive: true });
    const stamp = this.d.now().toISOString().replace(/[:.]/g, "-");
    const file = join(dir, `pb_data-${stamp}${from ? `-v${from}` : ""}.tar.gz`);
    const r = await this.d.exec(["tar", "-czf", file, "-C", dirname(data), basename(data)]);
    if (r.code !== 0) {
      rmSync(file, { force: true });
      throw new Failed(`Backing up pb_data failed: ${tail(r)}`);
    }
    const kept = readdirSync(dir).filter((n) => /^pb_data-.*\.tar\.gz$/.test(n)).sort();
    for (const old of kept.slice(0, Math.max(0, kept.length - BACKUPS))) rmSync(join(dir, old));
  }

  /** A TEF_NOTES_VERSION pinned in .env moves to `v`, so the owner's next `docker compose up` stays on it. Unpinned (latest),
   *  .env is left alone: latest is at least `v`. */
  private pin(v: string): void {
    const env = join(this.d.dir, ".env");
    if (!existsSync(env)) return;
    const text = readFileSync(env, "utf8");
    const line = /^(\s*TEF_NOTES_VERSION\s*=\s*)(\S+)[ \t]*$/m;
    if (!line.test(text)) return;
    const next = join(this.d.dir, ".env.updating");
    writeFileSync(next, text.replace(line, `$1${v}`));
    renameSync(next, env);
  }
}

function bindOf(c: Config): string {
  const m = c.services?.pocketbase?.volumes?.find((x) => x.target === "/pb/pb_data");
  return m?.type === "bind" && m.source ? m.source : "";
}

function pbData(c: Config): string {
  const s = bindOf(c);
  if (!s) throw new Failed("pb_data isn't a folder on the host");
  return s;
}
