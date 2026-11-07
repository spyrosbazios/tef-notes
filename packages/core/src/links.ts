// A pasted link gets readable text: the page's own title, fetched once, offered for the user to keep or
// edit. Read-only GETs; nothing about the user is sent but the URL they pasted.

const URL_RE = /\bhttps?:\/\/[^\s<>]+/g;
/** A sentence's trailing punctuation isn't the URL's, nor a `)` it didn't open: "(see https://w.org/A_(b))." → https://w.org/A_(b) */
function trimUrl(u: string) {
  for (;;) {
    if (/[.,;:!?]$/.test(u)) u = u.slice(0, -1);
    else if (u.endsWith(")") && u.split(")").length > u.split("(").length) u = u.slice(0, -1);
    else return u;
  }
}
const urls = (s: string) => (s.match(URL_RE) ?? []).map(trimUrl);
/** The first http(s) URL in `text`, as a reader would take it; null when there is none. */
export const firstUrl = (text: string): string | null => urls(text)[0] ?? null;
const ENT: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", middot: "·",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", bull: "•", copy: "©", reg: "®", trade: "™",
};

export function decode(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? all);
}

const clean = (s: string, max = 120) => {
  const t = decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** og:title, then twitter:title, then <title>. Attribute order varies, so match either way round. */
export function titleFromHtml(html: string): string | null {
  for (const name of ["og:title", "twitter:title"]) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, "i");
    const tag = re.exec(html)?.[0], c = tag && /content=(["'])([\s\S]*?)\1/i.exec(tag)?.[2];
    if (c && clean(c)) return clean(c);
  }
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return t && clean(t) ? clean(t) : null;
}

/** `url` in `entry` becomes `[text](url)`. */
export function linkify(entry: string, url: string, text: string) {
  const t = text.replace(/\s+/g, " ").trim().replace(/[[\]\\]/g, "\\$&");
  return t ? entry.replace(url, () => `[${t}](${url})`) : entry;   // a function: no $& / $$ patterns in a title
}

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

async function get(url: string, ms: number, json: boolean): Promise<any> {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: json ? { Accept: "application/json" } : { Accept: "text/html" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return json ? r.json() : (await r.text()).slice(0, 400_000);
  } finally {
    clearTimeout(timer);
  }
}

/** X posts and YouTube have oEmbed (their pages are scripts or a consent wall); the rest, the page's head. */
export async function linkTitle(url: string, ms = 6000): Promise<string | null> {
  const h = host(url);
  if (/^(x|twitter|mobile\.twitter)\.com$/.test(h)) {
    const o = await get(`https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(url)}`, ms, true);
    const text = clean(/<p[^>]*>([\s\S]*?)<\/p>/i.exec(o.html ?? "")?.[1] ?? "", 100);
    return o.author_name ? (text ? `${o.author_name}: ${text}` : `${o.author_name} on X`) : null;
  }
  if (/^(youtube\.com|m\.youtube\.com|youtu\.be)$/.test(h)) {
    const o = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, ms, true);
    return o.title ? clean(o.title) : null;
  }
  return titleFromHtml(await get(url, ms, false));
}

/** The note a link in a note or an answer points at, as `notes/<file>.md`: a relative link the laptop wrote
 *  (`20261001-foo.md`, `notes/foo.md`, `../notes/foo.md`), its `#section` dropped. null for anything with a
 *  scheme (`https:`, `mailto:`), which the OS opens. */
export function noteLinkPath(url: string): string | null {
  if (/^[a-z][a-z\d+.-]*:/i.test(url)) return null;
  const m = /(?:^|\/)(?:notes\/)?([^/]+\.md)$/.exec(url.replace(/[?#].*$/, ""));
  if (!m) return null;
  let name = m[1];
  try { name = decodeURIComponent(name); } catch { /* a stray % */ }
  return `notes/${name}`;
}

/** The video a YouTube link plays, and where to start (seconds): a watch page, a short, a live, an embed or a youtu.be
 *  link. null for anything else (a channel, a playlist alone, another site). */
export function youtubeVideo(url: string): { id: string; start: number } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const h = u.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (h === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (h === "youtube.com" || h === "youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else id = /^\/(?:shorts|live|embed|v)\/([^/]+)/.exec(u.pathname)?.[1] ?? null;
  }
  if (!id || !/^[\w-]{11}$/.test(id)) return null;
  const t = u.searchParams.get("t") ?? u.searchParams.get("start") ?? "";
  const hms = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t);
  const start = hms ? (+(hms[1] ?? 0)) * 3600 + (+(hms[2] ?? 0)) * 60 + (+(hms[3] ?? 0)) : 0;
  return { id, start };
}

/** The player's address for a video `youtubeVideo` read: YouTube's privacy-enhanced embed, playing at once. */
export const youtubeEmbed = (v: { id: string; start: number }) =>
  `https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&rel=0&playsinline=1${v.start ? `&start=${v.start}` : ""}`;
