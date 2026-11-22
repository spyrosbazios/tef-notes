// The core reads no clock, and outside src/client/ (client/ids.ts) draws no random number: a caller hands it `today`, `now` and
// new ids (AGENTS.md, Ownership). Its imports are check-boundaries.ts's; these are globals, so they are looked for in the source.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const src = join(import.meta.dir, "../src");
const CLOCK = [/\bDate\.now\(/, /\bnew Date\(\s*\)/, /\bperformance\.now\(/];
const RANDOM = [/\bMath\.random\(/, /\bcrypto\./];

test("nothing in the core reads the clock, and nothing outside client/ draws a random number", () => {
  const found: string[] = [];
  for (const name of readdirSync(src, { recursive: true, encoding: "utf8" })) {
    if (!name.endsWith(".ts")) continue;
    const reads = name.startsWith("client/") ? CLOCK : [...CLOCK, ...RANDOM];
    readFileSync(join(src, name), "utf8").split("\n").forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "");
      if (reads.some((r) => r.test(code))) found.push(`${name}:${i + 1}: ${line.trim()}`);
    });
  }
  expect(found).toEqual([]);
});
