// The provider keys, one file each at `<TEF_NOTES_KEYS_DIR or /run>/<name>/api-key`: docker-compose.yml mounts each
// provider's directory read-only. Read on every use, so a new key needs no restart. Never logged: a failure logs its status.
const { env } = require("./env.js");

/** The file as text; the default reader is PocketBase's `$os` (bun's tests pass their own). */
const readFile = (path) => toString($os.readFile(path));

/** The trimmed key, "" when the file is missing or empty. */
function read(name, reader = readFile) {
  try { return String(reader(`${env("TEF_NOTES_KEYS_DIR") || "/run"}/${name}/api-key`)).trim(); } catch (_) { return ""; }
}

module.exports = { read };
