// How Remotion bundles the film. The screens it shows are the site's (../site/src/components/mock), so the film reads
// `@/` as the site does and compiles Tailwind over both trees. Every bare import, from whichever tree, lands in this
// module's node_modules: one React, and this lockfile decides the versions, whether or not site/ is installed.
import { createRequire } from "node:module";
import path from "node:path";
import type { WebpackOverrideFn } from "@remotion/bundler";

/** The override for the film rooted at `root`, this directory. The render script and remotion.config.ts both pass it. */
export function override(root: string): WebpackOverrideFn {
  const require = createRequire(path.join(root, "package.json"));
  return (config) => ({
    ...config,
    resolve: {
      ...config.resolve,
      modules: [path.join(root, "node_modules"), "node_modules"],
      alias: { "@/core": path.join(root, "../packages/core/src"), "@": path.join(root, "../site/src"), ...config.resolve?.alias },
    },
    module: {
      ...config.module,
      rules: [
        // Remotion's own CSS rule gives way to Tailwind's loader, which also follows look.css's fonts to ../assets.
        ...(config.module?.rules ?? []).filter((rule) => !(rule && rule !== "..." && String(rule.test).includes(".css"))),
        { test: /\.css$/i, use: [require.resolve("style-loader"), require.resolve("css-loader"), require.resolve("@tailwindcss/webpack")] },
      ],
    },
  });
}
