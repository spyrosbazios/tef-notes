/// <reference path="../pb_data/types.d.ts" />
// GET /api/tefnotes/page?url=<http(s) URL>: the HTML of a page, fetched through lib/link-preview.js's guard (every hop
// checked, the checked address pinned), for the agent's reader (server/agent/src/reader.ts), which parses it into an
// article. The fetch lives here so there is one SSRF guard, not a second one in the agent. Nothing cached: an article
// is read once, and the page is cut at PAGE_BYTES.
//
// 200 `{ url, html }`, url the last hop's; 400 a URL this server won't fetch; 422 an error page or no HTML; 502 the site
// didn't answer. No sign-in, like the rest: the tailnet is the gate, and it is why the guard exists.

routerAdd("GET", "/api/tefnotes/page", (e) => require(`${__hooks}/lib/http.js`).route(e, "page", "The page could not be fetched.", () => {
  const lib = require(`${__hooks}/lib/link-preview.js`);
  let url;
  try { url = lib.parseUrl(e.request.url.query().get("url") || "").href; } catch (err) {
    if (err instanceof lib.Blocked) return e.json(400, { error: `The server won't fetch that page: ${err.message}.` });
    throw err;
  }
  let page;
  try { page = lib.htmlOf(url, lib.io({ max: lib.PAGE_BYTES })); } catch (err) {
    if (err instanceof lib.Blocked) return e.json(400, { error: `The server won't fetch that page: ${err.message}.` });
    return e.json(502, { error: `The site didn't answer: ${err.message}.` });
  }
  if (!page) return e.json(422, { error: "That is no web page." });
  return e.json(200, page);
}));
