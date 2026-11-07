// An environment variable, "" when unset. PocketBase's hooks read it through `$os`; bun (server/test) has none of
// PocketBase's globals, so it falls back to `process.env`.

/** The variable's value, "" when it is unset. */
const env = (name) => (typeof $os !== "undefined" ? $os.getenv(name) : process.env[name]) || "";

module.exports = { env };
