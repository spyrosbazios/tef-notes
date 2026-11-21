// Preloaded by server/bunfig.toml: builds pb_hooks/lib/core.js, the hooks' bundle of the clients' code, before any test
// requires it.
import { buildCore } from "../pb_hooks/bundle/build";

await buildCore();
