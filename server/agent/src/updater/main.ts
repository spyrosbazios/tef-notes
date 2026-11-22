// The updater service (update.ts): opt-in (compose profile `updater`), reached only by the agent over the compose network, no
// port on the host. Image: server/agent/updater.Dockerfile. Routes:
//   GET  /status  -> UpdaterStatus
//   POST /update  UpdateBody -> 202 UpdateState, or 409 with the reason
import { RELEASES_REPO } from "@/core/release";
import { Updater, type Ran } from "./update";

const dir = process.env.TEF_NOTES_DIR ?? "";
if (!dir.startsWith("/")) throw new Error("TEF_NOTES_DIR must be the compose project's absolute path (docker-compose.yml sets it)");

/** Runs in the project's folder, as the owner's own `docker compose` does: it finds the compose files and .env there, and
 *  ${PWD} in docker-compose.yml is that folder. */
const spawn = async (cmd: string[], env?: Record<string, string>): Promise<Ran> => {
  const p = Bun.spawn(cmd, { cwd: dir, env: { ...process.env, PWD: dir, ...env }, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err };
};

/** Whether GitHub has `version` as a published release. */
async function published(version: string): Promise<boolean> {
  const r = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/tags/v${version}`, {
    headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) return false;
  const body = (await r.json()) as { draft?: boolean };
  return body.draft !== true;
}

const updater = new Updater({
  docker: (args, env) => spawn(["docker", ...args], env),
  exec: (cmd) => spawn(cmd),
  published,
  dir,
  now: () => new Date(),
  backup: process.env.TEF_NOTES_UPDATE_BACKUP !== "off",
});

const port = Number(process.env.PORT ?? 8099);
Bun.serve({
  port,
  hostname: "0.0.0.0",
  routes: {
    "/status": { GET: async () => Response.json(await updater.status()) },
    "/update": {
      POST: async (req) => {
        const body = (await req.json().catch(() => null)) as { version?: unknown } | null;
        const r = updater.start(body?.version);
        return "refused" in r ? new Response(r.refused, { status: 409 }) : Response.json(r.state, { status: 202 });
      },
    },
  },
  fetch: () => new Response("Not found", { status: 404 }),
});
console.error(`updater: listening on ${port}, project at ${dir}`);
