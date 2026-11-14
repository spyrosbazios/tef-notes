// Opt-in only: ordinary `bun test` never discovers contract.ts.
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const application = process.argv.slice(2).includes("--application");
if (process.argv.slice(2).some((arg) => arg !== "--application")) throw new Error("Usage: run.ts [--application]");

const server = resolve(import.meta.dir, "..");
const version = (await Bun.file(join(server, "Dockerfile")).text()).match(/^ARG PB_VERSION=(\d+\.\d+\.\d+)$/m)?.[1];
if (!version) throw new Error("Cannot read production PocketBase pin from server/Dockerfile");
const root = await mkdtemp(join(tmpdir(), "tefnotes-contract-"));
// Do not inherit deployment configuration, proxies, provider keys, or Bun's .env loading.
const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: root, TMPDIR: root, TZ: "UTC",
  TEF_NOTES_KEYS_DIR: join(root, "empty-keys") };
let pb: ReturnType<typeof Bun.spawn> | undefined;
let tests: ReturnType<typeof Bun.spawn> | undefined;
let log = "";
let interrupted = false;
async function stop(child: typeof pb) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
  await child.exited;
  clearTimeout(timer);
}
const abort = () => { interrupted = true; void stop(tests); void stop(pb); };
process.on("SIGINT", abort);
process.on("SIGTERM", abort);
async function command(args: string[]) {
  if (interrupted) throw new Error("Integration run interrupted");
  const p = Bun.spawn(args, { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code) throw new Error(`${args[0]} failed (${code}): ${err}`);
  return out;
}
try {
  await mkdir(env.TEF_NOTES_KEYS_DIR);
  await cp(join(server, "pb_hooks"), join(root, "pb_hooks"), { recursive: true });
  await cp(join(server, "pb_migrations"), join(root, "pb_migrations"), { recursive: true });
  let binary = process.env.TEF_TEST_POCKETBASE ? resolve(process.env.TEF_TEST_POCKETBASE) : Bun.which("pocketbase");
  if (!binary) {
    const os = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : null;
    const arch = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : null;
    if (!os || !arch) throw new Error("Unsupported platform; provide TEF_TEST_POCKETBASE at the production version");
    const asset = `pocketbase_${version}_${os}_${arch}.zip`;
    const base = `https://github.com/pocketbase/pocketbase/releases/download/v${version}`;
    await command(["curl", "--fail", "--silent", "--show-error", "--location", "--max-time", "120", `${base}/${asset}`, "-o", join(root, asset)]);
    const sums = await command(["curl", "--fail", "--silent", "--show-error", "--location", "--max-time", "30", `${base}/checksums.txt`]);
    const expected = sums.split("\n").map((s) => s.trim().split(/\s+/)).find((p) => p[1] === asset)?.[0];
    const actual = new Bun.CryptoHasher("sha256").update(await Bun.file(join(root, asset)).arrayBuffer()).digest("hex");
    if (!expected || actual !== expected) throw new Error("PocketBase release checksum mismatch");
    await command(["unzip", "-q", join(root, asset), "pocketbase", "-d", root]);
    binary = join(root, "pocketbase");
  }
  const reported = (await command([binary, "--version"])).trim();
  if (reported !== `pocketbase version ${version}`) throw new Error(`Expected PocketBase ${version}, got ${reported}`);
  if (interrupted) throw new Error("Integration run interrupted");
  // Reserve an OS-assigned loopback port; never accept a target URL or production port.
  const reservation = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = reservation.port;
  reservation.stop(true);
  if ([8090, 8097, 8098].includes(port)) throw new Error("Refusing reserved production port");
  const url = `http://127.0.0.1:${port}`;
  pb = Bun.spawn([binary, "serve", "--dev=false", `--http=127.0.0.1:${port}`, `--dir=${root}/pb_data`,
    `--hooksDir=${root}/pb_hooks`, `--migrationsDir=${root}/pb_migrations`, `--publicDir=${root}/pb_public`],
    { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  const drain = async (stream: ReadableStream) => {
    for await (const chunk of stream) log = (log + new TextDecoder().decode(chunk)).slice(-32000);
  };
  const logs = Promise.all([drain(pb.stdout as ReadableStream), drain(pb.stderr as ReadableStream)]);
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (pb.exitCode !== null) throw new Error("PocketBase exited before readiness");
    try { ready = (await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
    if (ready) break;
    await Bun.sleep(100);
  }
  if (!ready) throw new Error("PocketBase readiness timeout");
  // A wrapper outside the checkout opts into Bun discovery without adding a default-discovered test file.
  const wrapper = join(root, "contract.test.ts");
  const suites = ["contract.ts", ...(application ? ["application.ts"] : [])];
  await Bun.write(wrapper, suites.map((suite) => `import ${JSON.stringify(pathToFileURL(join(import.meta.dir, suite)).href)};`).join("\n"));
  if (interrupted) throw new Error("Integration run interrupted");
  tests = Bun.spawn([process.execPath, "--no-env-file", "test", wrapper, "--timeout", "15000"],
    { cwd: root, env: { ...env, TEF_CONTRACT_URL: url }, stdout: "inherit", stderr: "inherit" });
  const code = await tests.exited;
  await stop(pb);
  await logs;
  if (interrupted || code) throw new Error(`Contract tests failed or interrupted (${code})`);
} catch (error) {
  console.error(error);
  if (log) console.error(log.replace(/(\/pbinstall\/)[^\s]+/g, "$1[redacted]"));
  process.exitCode = 1;
} finally {
  await stop(tests);
  await stop(pb);
  // Only the directory created by this invocation, after its children have stopped.
  await rm(root, { recursive: true, force: true });
  process.off("SIGINT", abort);
  process.off("SIGTERM", abort);
}
