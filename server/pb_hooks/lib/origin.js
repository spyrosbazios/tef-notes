// Which browser requests the server takes from where (origin.pb.js). Nothing is signed in, so a page on any other site
// the owner visits could otherwise write: a multipart or text/plain POST is a "simple" request a browser sends without
// asking first, and CORS only decides whether that page may read the answer. So a request that changes something, and
// one to a route that fetches a URL for its caller, is refused when a browser says it comes from another site.
//
// Who sends what (Fetch Metadata, https://www.w3.org/TR/fetch-metadata/):
//   the web app      served from this origin: `Sec-Fetch-Site: same-origin` (an older browser without it: an `Origin`
//                    naming this host)
//   the extension    `Origin: chrome-extension://<id>`; a GET with the host permission may come with no Origin, as a
//                    `cors` mode request, which a web page's cross-site request never is without one
//   CLI, agent, Android companion   no Origin and no Sec-Fetch-*: not a browser, nothing to check
// A server that serves its signed extension (pb_public/extension/update.xml, server/Dockerfile's `with-extension`)
// takes that extension alone; one that serves none takes any (an unpacked build gets an id of its own).
//
// Plain CommonJS, so bun can test it (server/test/origin.test.js).

/** GETs that fetch a URL for whoever asks: refused cross-site like a write. */
const FETCHERS = new Set(["/api/tefnotes/page", "/api/tefnotes/clip/image", "/api/tefnotes/link-preview"]);

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The id of the extension in a served `update.xml`, or "" when there is none. */
function servedExtension(xml) {
  const m = /<app\s+appid="([a-p]{32})"/.exec(xml || "");
  return m ? m[1] : "";
}

/** The host of an origin (`https://host:port` -> `host:port`), or "" for "null" or anything unreadable. */
function hostOf(origin) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/]+)$/i.exec(origin);
  return m ? m[1].toLowerCase() : "";
}

/**
 * Why this request is refused, or null to go ahead. `r`: method, path, and the headers origin (Origin), site
 * (Sec-Fetch-Site), mode (Sec-Fetch-Mode), host (Host) and forwardedHost (X-Forwarded-Host, set by the reverse proxy;
 * a page can't send it without a preflight, which CORS refuses). `extension`: the served extension's id, or "".
 */
function refusal(r, extension) {
  if (READS.has(r.method) && !FETCHERS.has(r.path)) return null;
  const origin = r.origin || "";
  if (origin.startsWith("chrome-extension://")) {
    return extension && origin !== `chrome-extension://${extension}` ? "Only this server's extension may write to it." : null;
  }
  const no = "Requests from other sites are refused.";
  if (r.site) {
    if (r.site === "same-origin" || r.site === "none") return null;
    return !origin && r.mode === "cors" ? null : no;
  }
  if (!origin) return null;
  const from = hostOf(origin);
  return from && [r.host, r.forwardedHost].some((h) => h && h.toLowerCase() === from) ? null : no;
}

module.exports = { FETCHERS, servedExtension, refusal };
