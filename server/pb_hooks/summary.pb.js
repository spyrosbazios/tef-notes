/// <reference path="../pb_data/types.d.ts" />
// POST /api/tefnotes/summary  JSON { url: http(s) URL, title? }: a summary of the page a note links to, for the editor's
// "Summarise" button beside a link (web/src/editor/link-read.ts). The server fetches the page through lib/link-preview.js's
// guard and asks its model, the same way a clip's "Add a summary" does (lib/clip.js summarise). It writes nothing: the
// client puts the block in the note, an ordinary edit under the rev contract.
//
// 200 { summary } (the markdown block, a blockquote under a bold "Summary"); 400 a URL this server won't take; 422 nothing
// on the page worth summarising; 502 no key, the page or the model failed. No sign-in, like the rest: the tailnet is the gate.

routerAdd("POST", "/api/tefnotes/summary", (e) => {
  const lib = require(`${__hooks}/lib/clip.js`), lp = require(`${__hooks}/lib/link-preview.js`);
  const ds = require(`${__hooks}/lib/llm.js`).llm(), keys = require(`${__hooks}/lib/keys.js`);
  const log = (msg, ...kv) => e.app.logger().warn(`summary: ${msg}`, ...kv);
  const body = e.requestInfo().body || {};
  let url;
  try { url = lp.parseUrl(typeof body.url === "string" ? body.url : "").href; } catch (err) {
    if (err instanceof lp.Blocked) return e.json(400, { error: err.message });
    throw err;
  }
  const title = typeof body.title === "string" ? body.title.slice(0, 300) : "";
  const run = (name, ...args) => toString($os.exec(name, ...args).output());
  const key = ds.credential(keys.read);
  const r = lib.summarise({ url, title, text: "", selection: "", image: null }, {
    key,
    page: (u) => lp.textOf(u, { lookup: lp.getent(run), get: lp.curl(run) }),
    blocked: (err) => err instanceof lp.Blocked,
    ask: (system, user) => { const res = $http.send(ds.request(key, system, user, 30)); return { status: res.statusCode, text: res.statusCode === 200 ? ds.text(res.json) : "" }; },
    log,
  });
  if (r.outcome === "added") return e.json(200, { summary: r.block });
  if (r.outcome === "skipped") return e.json(422, { error: "There is nothing on that page to summarise." });
  return e.json(502, { error: "The summary couldn't be written." });
});
