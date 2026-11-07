// `@/` as in tsconfig (`@/core/` the shared package first), so store code (which imports through it) runs under test
// with native modules mocked.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/core\//, replacement: at("../packages/core/src/") },
      { find: /^@\//, replacement: at("./src/") },
    ],
  },
});
