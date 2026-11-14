// Read by Remotion's own commands (`bun run studio`). The render script passes the same override to bundle() itself.
import { Config } from "@remotion/cli/config";
import { override } from "./bundler";

Config.overrideWebpackConfig(override(process.cwd()));
