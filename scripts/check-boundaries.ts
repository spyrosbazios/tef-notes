// Runtime import boundaries, checked without installing any module's dependencies.
// Type-only references are erased by Bun's parser; this checks what a module actually loads.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

/** `direct`: only what a root imports itself is checked, not what it reaches through others (a layer that must go through the
 *  next one, which may then load what the first may not). */
export type Boundary = { name: string; roots: string[]; forbidden: (module: string) => boolean; direct?: boolean };

/** Follow re-exports and dynamic imports too; report the path that crosses a boundary. */
export function violations(rules: Boundary[], imports: (module: string) => string[]): string[] {
  const errors: string[] = [];
  for (const rule of rules) {
    const seen = new Set<string>();
    const visit = (module: string, chain: string[]) => {
      if (rule.forbidden(module)) { errors.push(`${rule.name}: ${[...chain, module].join(" -> ")}`); return; }
      if (seen.has(module) || (rule.direct && chain.length)) return;
      seen.add(module);
      for (const dependency of imports(module)) visit(dependency, [...chain, module]);
    };
    for (const root of rule.roots) visit(root, []);
  }
  return errors;
}

const root = resolve(import.meta.dir, "..");
const agent = "server/agent/src/";
const core = "packages/core/src/";
const adapters = new Set(["notes", "tools", "tagTools", "webTools", "todoTools", "widgetTools", "fileTools", "placeTools", "noteActionTools", "drawings", "assistant", "agent"].map((name) => `${agent}${name}.ts`));
const sdk = (name: string) => name === "external:ai" || name.startsWith("external:@ai-sdk/");
/** Every source file under `dir` (relative to the repo root), its subdirectories' too. */
const filesUnder = (dir: string): string[] =>
  readdirSync(resolve(root, dir), { recursive: true, encoding: "utf8" }).filter((name) => /\.tsx?$/.test(name)).map((name) => `${dir}${name}`);
/** What only the records module (web/src/lib/records.ts) loads: the local copy, the sync and its edit helpers. */
const copy = new Set(["web/src/lib/local.ts", "web/src/lib/sync.ts", "web/src/lib/local-records.ts", "web/src/lib/sync-controller.ts", `${core}sync.ts`, `${core}changes.ts`]);
const pure = ["notes", "todo", "sync", "changes", "prefs", "prefs-sync", "record-contracts", "record-protocol", "chat-history"];

function rules(): Boundary[] {
  return [
    {
      name: "Core domain and sync must not load HTTP adapters or external packages",
      roots: pure.map((name) => `${core}${name}.ts`),
      forbidden: (name) => !name.startsWith(core) || ["pocketbase", "http", "tags", "import"].some((part) => name === `${core}${part}.ts`),
    },
    {
      name: "Application services must not load assistant adapters, cards or AI SDK",
      roots: readdirSync(resolve(root, agent, "application")).filter((name) => name.endsWith(".ts")).map((name) => `${agent}application/${name}`),
      forbidden: (name) => adapters.has(name) || name === `${core}agent.ts` || sdk(name),
    },
    {
      name: "Companion and word/semantic search must not load chat tooling",
      roots: [`${agent}companion.ts`, `${agent}search.ts`],
      forbidden: (name) => adapters.has(name) || sdk(name),
    },
    {
      name: "Guard and loop receive policy; they must not load the tool registry",
      roots: [`${agent}guard.ts`, `${agent}loop.ts`],
      forbidden: (name) => adapters.has(name),
    },
    {
      name: "Sync controller receives storage and transport; it must not load UI or services",
      roots: ["web/src/lib/sync-controller.ts"],
      forbidden: (name) => /^web\/src\/(hooks|services|components)\//.test(name) || name.startsWith("external:"),
    },
    {
      name: "Hooks read and write records through lib/records.ts, never the copy or the sync themselves",
      roots: filesUnder("web/src/hooks/"),
      forbidden: (name) => copy.has(name),
      direct: true,
    },
    {
      name: "Components reach records through hooks, never the records module, the copy or the sync",
      roots: filesUnder("web/src/components/"),
      forbidden: (name) => copy.has(name) || name === "web/src/lib/records.ts",
      direct: true,
    },
    ...["notes", "todo", "links"].map((feature): Boundary => ({
      name: `${feature} hooks must not coordinate another record feature's projections`,
      roots: [`web/src/hooks/${feature}.ts`],
      // A feature can reach itself through another legitimate hook, but not another record feature.
      forbidden: (name) => ["notes", "todo", "links"].some((other) => other !== feature && name === `web/src/hooks/${other}.ts`),
    })),
  ];
}

function imports(module: string): string[] {
  if (module.startsWith("external:")) return [];
  const file = resolve(root, module);
  const parser = new Bun.Transpiler({ loader: module.endsWith(".tsx") ? "tsx" : "ts" });
  return parser.scan(readFileSync(file, "utf8")).imports.map(({ path }) => {
    const target = path.startsWith("@/core/") ? resolve(root, core, path.slice(7))
      : path.startsWith("@/") && module.startsWith("web/") ? resolve(root, "web/src", path.slice(2))
      : path.startsWith(".") ? resolve(dirname(file), path) : null;
    if (!target) return `external:${path}`;
    const found = [target, `${target}.ts`, `${target}.tsx`, `${target}.js`, `${target}/index.ts`].find((candidate) => existsSync(candidate));
    if (!found) throw new Error(`Cannot resolve ${path} from ${module}`);
    return relative(root, found);
  });
}

if (import.meta.main) {
  const errors = violations(rules(), imports);
  if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
  else console.log("Architecture import boundaries passed.");
}
