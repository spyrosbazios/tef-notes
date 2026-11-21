/// <reference path="../pb_data/types.d.ts" />
// Requests from other sites: refused before any route runs when they change something or fetch a URL (lib/origin.js
// says which and why). CORS (server/Dockerfile's --origins) only governs what a page may read back; this is what keeps
// a page the owner visits from writing. A 403 { error }. A handler runs in its own VM: the lib is required inside.

routerUse((e) => {
  const lib = require(`${__hooks}/lib/origin.js`);
  let extension = e.app.store().get("origin-extension");
  if (extension == null) {
    try { extension = lib.servedExtension(toString($os.readFile(`${__hooks}/../pb_public/extension/update.xml`))); } catch (_) { extension = ""; }
    e.app.store().set("origin-extension", extension);
  }
  const h = (name) => e.request.header.get(name);
  const no = lib.refusal({
    method: e.request.method, path: e.request.url.path,
    origin: h("Origin"), site: h("Sec-Fetch-Site"), mode: h("Sec-Fetch-Mode"), host: e.request.host, forwardedHost: h("X-Forwarded-Host"),
  }, extension);
  if (no) return e.json(403, { error: no });
  return e.next();
});
