// What a link preview is made of: the URL guard, the fetch loop and the page parser. Plain CommonJS with no PocketBase
// globals (the hook passes its `$os` in as `run`), so bun can test it (server/test) and the route can `require` it:
// a PocketBase handler runs in a fresh VM that sees none of its file's top-level scope.
//
// The guard is the point. The server sits inside the tailnet and the LAN, and a URL in a note is whatever someone
// pasted, so a fetch must never reach loopback, a private or tailnet address, or anything that resolves to one, and
// a redirect is a new URL to check, not something to follow. $http.send can do none of that (it follows ten
// redirects unseen and reads the whole body), hence curl: one hop at a time, the checked address pinned with
// --resolve so the name cannot resolve elsewhere between the check and the connect, the body cut at MAX_BYTES.

const MAX_BYTES = 300000;
const PAGE_BYTES = 3000000;                  // a whole page for the reader (htmlOf): an article's HTML runs past a preview's head
const IMAGE_BYTES = 20 * 1024 * 1024;        // a picture the clip route fetches (curlFile): one this size or over was cut
const MAX_REDIRECTS = 4;
const BUDGET_MS = 15000;
const FOUND_TTL = 7 * 24 * 3600 * 1000;      // how long a cached preview with something in it is good
const EMPTY_TTL = 3600 * 1000;               // one that has nothing, or whose site didn't answer
const KEEP_TTL = 90 * 24 * 3600 * 1000;      // how long a record nobody refreshed stays
const UA ="Mozilla/5.0 (compatible; TEF NotesLinkPreview/1.0)";

/** An URL the server refuses to fetch (not a failure of the site: nothing is cached for it). */
class Blocked extends Error {}

// ---- addresses

/** `a.b.c.d` as a 32-bit number; null unless it is four plain decimal octets (no leading zeros: curl reads those as octal). */
function v4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    if (m[i].length > 1 && m[i][0] === "0") return null;
    const o = Number(m[i]);
    if (o > 255) return null;
    n = n * 256 + o;
  }
  return n;
}

// [network, prefix length]: everything that is not the public internet
const PRIVATE_V4 = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
].map(([net, bits]) => ({ net: v4(net), bits }));

function publicV4(n) {
  return !PRIVATE_V4.some(({ net, bits }) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(net / 2 ** (32 - bits)));
}

/** An IPv6 address as eight 16-bit groups; null when it is not one (zone ids included). */
function v6(s) {
  if (!s.includes(":") || !/^[0-9a-f:.]+$/i.test(s)) return null;
  const dot = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);        // ::ffff:1.2.3.4: the dotted tail is two groups
  if (dot) {
    const n = v4(dot[2]);
    if (n === null) return null;
    s = `${dot[1]}${Math.floor(n / 65536).toString(16)}:${(n % 65536).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (part) => (part === "" ? [] : part.split(":").map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN)));
  const head = parse(halves[0]), rest = halves.length === 2 ? parse(halves[1]) : [];
  const gap = 8 - head.length - rest.length;
  const all = halves.length === 2 ? (gap >= 1 ? [...head, ...new Array(gap).fill(0), ...rest] : []) : head;
  return all.length === 8 && all.every((g) => Number.isInteger(g)) ? all : null;
}

function publicV6(g) {
  const embedded = (a, b) => publicV4(g[a] * 65536 + g[b]);
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return embedded(6, 7);       // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return embedded(6, 7);   // NAT64
  if ((g[0] & 0xe000) !== 0x2000) return false;                                            // only 2000::/3 is global unicast
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return false;                    // Teredo, documentation
  if (g[0] === 0x2002) return false;                                                       // 6to4
  return true;
}

/** Whether an address literal (v4 or v6) is on the public internet. False for anything that is not an address. */
function isPublicIp(ip) {
  const a = v4(ip);
  if (a !== null) return publicV4(a);
  const g = v6(ip);
  return g !== null && publicV6(g);
}

// ---- URLs

const NAME = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/;
const INTERNAL = /(?:^|\.)(?:localhost|local|localdomain|internal|intranet|lan|home|corp|private|test|invalid|example|onion|ts\.net|home\.arpa)$/;

/** `{ host, port, href }` of an absolute http(s) URL, fragment dropped; throws Blocked for anything else. Hosts are
 *  ASCII names with a letter-led last label, or canonical IP literals: `0x7f.1`, `2130706433` and single-label
 *  names (`localhost`, `nas`) are refused rather than guessed at, since curl would read them as addresses. */
function parseUrl(raw) {
  if (typeof raw !== "string" || raw.length > 2048 || /[\s\x00-\x1f\x7f]/.test(raw)) throw new Blocked("not a URL");
  const m = /^(https?):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(?:#.*)?$/i.exec(raw);
  if (!m) throw new Blocked("only http and https URLs");
  const scheme = m[1].toLowerCase(), auth = m[2];
  if (auth.includes("@")) throw new Blocked("no credentials in a URL");
  const h = /^(\[[0-9a-f:.]+\]|[^:[\]]+)(?::(\d{1,5}))?$/i.exec(auth);
  if (!h) throw new Blocked("not a URL");
  const bracket = h[1][0] === "[";
  const host = (bracket ? h[1].slice(1, -1) : h[1]).toLowerCase().replace(/\.$/, "");
  const port = h[2] ? Number(h[2]) : scheme === "https" ? 443 : 80;
  if (port < 1 || port > 65535) throw new Blocked("not a URL");
  if (bracket) {
    if (!isPublicIp(host)) throw new Blocked("not a public address");
  } else if (v4(host) !== null) {
    if (!isPublicIp(host)) throw new Blocked("not a public address");
  } else if (!NAME.test(host) || INTERNAL.test(host)) {
    throw new Blocked("not a public host");
  }
  const hostPart = bracket ? `[${host}]` : host;
  const href = `${scheme}://${hostPart}${h[2] ? `:${port}` : ""}${m[3] || "/"}${m[4] || ""}`;
  return { scheme, host, bracket, port, href };
}

/** `ref` as an absolute URL against `base` (an absolute one): the cases pages and Location headers use. */
function resolveUrl(base, ref) {
  ref = ref.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return ref;
  const m = /^([a-z]+:\/\/[^/?#]*)([^?#]*)(\?[^#]*)?/i.exec(base);
  if (!m) return ref;
  if (ref.startsWith("//")) return `${base.slice(0, base.indexOf(":"))}:${ref}`;
  if (ref.startsWith("/")) return m[1] + ref;
  if (ref.startsWith("?")) return m[1] + m[2] + ref;
  if (ref.startsWith("#") || ref === "") return m[1] + m[2] + (m[3] || "");
  const dir = m[2].slice(0, m[2].lastIndexOf("/") + 1) || "/";
  const out = [];
  for (const seg of (dir + ref).split("/")) {
    if (seg === "..") { if (out.length > 1) out.pop(); } else if (seg !== ".") out.push(seg);
  }
  return m[1] + out.join("/");
}

// ---- the fetch

/** The address to connect to for `u`, checked: the literal itself, or the first of what `lookup(host)` returns when
 *  every one of those is public. Throws Blocked otherwise, and Error when the name does not resolve. */
function addressFor(u, lookup) {
  if (u.bracket || v4(u.host) !== null) return null;       // an IP literal: nothing to resolve, nothing to pin
  const ips = lookup(u.host);
  if (!ips.length) throw new Error("does not resolve");
  if (!ips.every(isPublicIp)) throw new Blocked("resolves to a private address");
  return ips.find((ip) => v4(ip) !== null) || ips[0];
}

/** Status, headers (lowercase names) and body of curl's `-i` output for a single response. */
function splitResponse(out) {
  const end = out.indexOf("\r\n\r\n");
  if (end < 0) return null;
  const lines = out.slice(0, end).split("\r\n");
  const status = /^HTTP\/\S+ (\d{3})/.exec(lines[0]);
  if (!status) return null;
  const headers = {};
  for (const l of lines.slice(1)) {
    const i = l.indexOf(":");
    if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  }
  return { status: Number(status[1]), headers, body: out.slice(end + 4) };
}

/**
 * The page at `raw`, redirects followed by hand (each hop is checked like the first). `io`:
 *   lookup(host) -> string[]          the addresses of a name
 *   get(args, seconds) -> string      curl's stdout for these extra arguments
 * Returns `{ url, status, type, body }` of the last response; throws Blocked for a URL refused, Error for a site that
 * did not answer.
 */
function fetchPage(raw, io, now = Date.now) {
  const t0 = now();
  let url = raw;
  for (let hop = 0; ; hop++) {
    const u = parseUrl(url), ip = addressFor(u, io.lookup);
    const left = Math.floor((BUDGET_MS - (now() - t0)) / 1000);
    if (left < 2) throw new Error("took too long");
    const pin = ip ? ["--resolve", `${u.host}:${u.port}:${u.bracket || ip.includes(":") ? `[${ip}]` : ip}`] : [];
    const res = splitResponse(io.get([...pin, "--", u.href], left));
    if (!res) throw new Error("no answer");
    const where = res.headers["location"];
    if (res.status >= 300 && res.status < 400 && where) {
      if (hop >= MAX_REDIRECTS) throw new Error("too many redirects");
      url = resolveUrl(u.href, where);
      continue;
    }
    return { url: u.href, status: res.status, type: (res.headers["content-type"] || "").toLowerCase(), body: res.body };
  }
}

/** The `io.get` over a command runner: `run(name, ...args)` returns stdout as a string and throws on failure. The
 *  response is cut at `max` bytes, headers included. */
function curl(run, max = MAX_BYTES) {
  return (args, seconds) => run("sh", "-c", `curl -sS -i --compressed --proto =http,https --max-redirs 0 --connect-timeout 5 --max-time ${seconds} -A '${UA}' -H 'Accept: text/html,application/xhtml+xml,image/*;q=0.5' -H 'Accept-Language: en,el;q=0.8' "$@" | head -c ${max}`, "sh", ...args);
}

/** The `io.get` for a picture (the clip route's): the body goes to the file `file`, cut at IMAGE_BYTES, and stdout
 *  carries the headers alone, so its bytes never pass through a JS string. Each hop overwrites the file. */
function curlFile(run, file) {
  return (args, seconds) => run("sh", "-c", `f="$1"; shift; curl -sS -D "$f.h" -o - --compressed --proto =http,https --max-redirs 0 --connect-timeout 5 --max-time ${seconds} -A '${UA}' -H 'Accept: image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' "$@" | head -c ${IMAGE_BYTES} > "$f"; cat "$f.h" 2>/dev/null; rm -f "$f.h"`, "sh", file, ...args);
}

/** The `io.lookup` over a command runner: `getent ahosts`, which answers like the resolver curl would use. */
function getent(run) {
  return (host) => {
    let out;
    try { out = run("timeout", "5", "getent", "ahosts", host); } catch (e) { return []; }
    return [...new Set(out.split("\n").map((l) => l.trim().split(/\s+/)[0]).filter(Boolean))];
  };
}

// ---- the page

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", middot: "·",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", bull: "•", copy: "©",
  reg: "®", trade: "™",
};

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] !== undefined ? ENTITIES[e.toLowerCase()] : all;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
  });
}

function clean(s, max) {
  const t = decode(String(s || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** A tag's attributes by lowercase name. */
function attrs(tag) {
  const out = {};
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g, body = tag.replace(/^<[^\s>/]+/, "");
  let m;
  while ((m = re.exec(body))) {
    const k = m[1].toLowerCase();
    if (!(k in out)) out[k] = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : "";
  }
  return out;
}

/** An image address the client may load: http(s) only, no private literal, `http` lifted to `https` (a page served
 *  over https will not draw an http image). */
function imageUrl(base, ref) {
  if (!ref) return "";
  let u;
  try { u = parseUrl(resolveUrl(base, decode(ref))); } catch (e) { return ""; }
  return u.href.replace(/^http:/, "https:");
}

const hostOf = (href) => parseUrl(href).host.replace(/^www\./, "");

/** The title, description, site name, picture and icon of an HTML page at `url`: OpenGraph, then Twitter cards, then
 *  the plain tags. Empty strings for what the page doesn't say. */
function parsePage(html, url) {
  const head = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, "");
  const top = head.slice(0, (/<\/head\s*>/i.exec(head) || { index: head.length }).index);
  const meta = {}, icons = [];
  for (const tag of top.match(/<(?:meta|link)\b[^>]*>/gi) || []) {
    const a = attrs(tag);
    if (/^<meta/i.test(tag)) {
      const k = (a.property || a.name || a.itemprop || "").toLowerCase();
      if (k && a.content !== undefined && !(k in meta)) meta[k] = a.content;
    } else if (a.href && /\bicon\b/i.test(a.rel || "") && !/mask-icon/i.test(a.rel)) {
      icons.push({ href: a.href, apple: /apple-touch/i.test(a.rel), size: parseInt((a.sizes || "").split("x")[0], 10) || 0 });
    }
  }
  const first = (...keys) => keys.map((k) => meta[k]).find((v) => v && clean(v, 1000));
  const tag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(top);
  const icon = icons.find((i) => !i.apple) || icons.sort((a, b) => b.size - a.size)[0];
  return {
    title: clean(first("og:title", "twitter:title") || (tag ? tag[1] : ""), 200),
    description: clean(first("og:description", "twitter:description", "description"), 300),
    site: clean(first("og:site_name", "application-name") || hostOf(url), 80),
    image: imageUrl(url, first("og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src")),
    icon: imageUrl(url, icon ? icon.href : "/favicon.ico"),
  };
}

// ---- oEmbed

// Sites whose pages hide their tags from a capped fetch (YouTube's OpenGraph sits past the first MAX_BYTES), asked
// through their oEmbed endpoint instead: a small JSON fetched by the same guarded fetchPage. Host (no `www.`) to endpoint.
const OEMBED = {
  "youtube.com": "https://www.youtube.com/oembed",
  "m.youtube.com": "https://www.youtube.com/oembed",
  "music.youtube.com": "https://www.youtube.com/oembed",
  "youtu.be": "https://www.youtube.com/oembed",
  "vimeo.com": "https://vimeo.com/api/oembed.json",
  "player.vimeo.com": "https://vimeo.com/api/oembed.json",
};

/** The oEmbed endpoint for `raw`, or "" when its site has none here. */
function oembedFor(raw) {
  let host;
  try { host = parseUrl(raw).host.replace(/^www\./, ""); } catch (e) { return ""; }
  return OEMBED[host] || "";
}

/** A preview from the oEmbed answer for `raw` at `endpoint`; null when it gives no title (the caller falls back to
 *  the page). */
function oembedPreview(raw, endpoint, io) {
  const page = fetchPage(`${endpoint}?format=json&url=${encodeURIComponent(raw)}`, io);
  if (page.status >= 400) return null;
  let j;
  try { j = JSON.parse(page.body); } catch (e) { return null; }
  if (!j || typeof j.title !== "string" || !clean(j.title, 200)) return null;
  const site = clean(j.provider_name, 80) || hostOf(raw);
  const author = clean(j.author_name, 120);
  return {
    title: clean(j.title, 200),
    description: author,
    site,
    image: typeof j.thumbnail_url === "string" ? imageUrl(endpoint, j.thumbnail_url) : "",
    icon: imageUrl(endpoint, "/favicon.ico"),
  };
}

/** A preview of `raw`: what the page says about itself, or, for a link straight to a picture, that picture. Every
 *  field is a string, empty when unknown. Throws Blocked or Error as fetchPage does; a site that answers with an error
 *  page or something that is not a web page gives an empty preview. */
function previewOf(raw, io) {
  const endpoint = oembedFor(raw);
  if (endpoint) {
    let found = null;
    try { found = oembedPreview(raw, endpoint, io); } catch (e) { if (e instanceof Blocked) throw e; }
    if (found) return found;
  }
  const page = fetchPage(raw, io);
  const empty = { title: "", description: "", site: "", image: "", icon: "" };
  if (page.status === 429 || page.status >= 500) throw new Error(`the site answered ${page.status}`);   // busy or rate-limited: ask again later, never cache it as a page with nothing
  if (page.status >= 400) return empty;
  if (/^image\//.test(page.type)) {
    let name = page.url.replace(/[?#].*$/, "").replace(/^.*\//, "");
    try { name = decodeURIComponent(name); } catch (e) { /* a stray % */ }
    name = name.slice(0, 200);
    return { ...empty, title: name || hostOf(page.url), site: hostOf(page.url), image: imageUrl(page.url, page.url) };
  }
  if (page.type && !/html/.test(page.type)) return empty;
  return parsePage(page.body, page.url);
}

const TEXT_CHARS = 30000;                    // of a page's text kept by pageText

/** The readable text of an HTML page, one block per line: the article or main part when the page has one (and it holds
 *  something), else the whole page; scripts, styles, menus, footers, asides and forms left out. */
function pageText(html, max = TEXT_CHARS) {
  let h = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template|svg|nav|footer|aside|form)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const plain = (x) => decode(x.replace(/<(?:br|\/p|\/div|\/li|\/ul|\/ol|\/h[1-6]|\/tr|\/blockquote|\/section|\/article|\/header|\/pre)\b[^>]*>/gi, "\n").replace(/<[^>]*>/g, " "))
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
  const main = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1\s*>/i.exec(h);
  const inner = main ? plain(main[2]) : "";
  const text = inner.length >= 500 ? inner : plain((/<body\b[^>]*>([\s\S]*)/i.exec(h) || [0, h])[1]);
  return text.length > max ? text.slice(0, max) : text;
}

/** The text of the page at `raw`, fetched as fetchPage does (every hop checked); "" for an error page or something that is
 *  no text. Throws Blocked or Error as fetchPage does. */
function textOf(raw, io) {
  const page = fetchPage(raw, io);
  if (page.status >= 400) return "";
  if (/^text\/plain/.test(page.type)) return page.body.trim().slice(0, TEXT_CHARS);
  if (page.type && !/html/.test(page.type)) return "";
  return pageText(page.body);
}

/** The HTML of the page at `raw` for the reader (the agent's /agent/reader parses it): `{ url, html }`, url the last
 *  hop's; null for an error page or something that is not HTML. Throws Blocked or Error as fetchPage does. */
function htmlOf(raw, io) {
  const page = fetchPage(raw, io);
  if (page.status >= 400 || (page.type && !/html/.test(page.type))) return null;
  return { url: page.url, html: page.body };
}

module.exports = { FOUND_TTL, PAGE_BYTES, htmlOf, EMPTY_TTL, KEEP_TTL, IMAGE_BYTES, Blocked, isPublicIp, parseUrl, resolveUrl, fetchPage, parsePage, pageText, textOf, previewOf, curl, curlFile, getent };
