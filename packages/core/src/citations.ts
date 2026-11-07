// The sources an agent answer rests on, and the citations in it: the notes, pages and PDFs this turn's tool calls
// read, and the inline links in the answer that name them, numbered in the order the answer first cites them. The web
// app draws a chip with a preview for each; the phone a list under the answer. Pure: the sidecar and both clients read
// their own message parts with it (the cards' `cardsByPart` is the same idea for writes).
import { isNotePath, noteIdOf, parseNote, snippetOf } from "./notes";

/** What a source is: a note, a web page, or a PDF attached to a note. */
export type CiteKind = "note" | "page" | "pdf";

/** A source an answer can cite: what a tool call in the turn read. `href`: how the answer names it, matched against the
 *  target of a markdown link. `site`: the short label on the chip (a host, or "Note"/"PDF"). */
export type CiteSource = {
  kind: CiteKind;
  href: string;
  title: string;
  site: string;
  /** The page's address, for a page. */
  url?: string;
  /** The note's path, for a note (and the note a PDF hangs off). */
  path?: string;
  /** Addresses the source also answers to (a redirect's original, the URL a page was fetched by), matched too. */
  also?: string[];
  /** The passage that backs the claim, shown in the preview. */
  snippet?: string;
};

/** A source as the answer cites it: `n`, its number, from the order it is first cited. */
export type Citation = CiteSource & { n: number };

const WWW = /^www\./;

/** The host a chip shows, `www.` dropped; the address itself when it can't be read. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(WWW, "") || url;
  } catch {
    return url;
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" ? (v as Record<string, unknown>) : undefined);
const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);

const noteSource = (path: string, title: string, snippet: string): CiteSource =>
  ({ kind: "note", href: path, path, title: title || path, site: "Note", ...(snippet ? { snippet } : {}) });

const pageSource = (url: string, title: string, snippet: string, also: string[] = []): CiteSource =>
  ({ kind: "page", href: url, url, title: title || hostOf(url), site: hostOf(url), ...(also.length ? { also } : {}), ...(snippet ? { snippet } : {}) });

const excerpt = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean).join(" ") : str(v));

/** The sources one turn's message parts hold: what read_note, search_notes, list_notes, read_page, read_url,
 *  web_search and read_attachment read, in the order they were read, deduped. Anything that isn't a source is left
 *  out, so a chat saved by another version still reads. */
export function sourcesOf(parts: readonly object[]): CiteSource[] {
  const out: CiteSource[] = [], seen = new Set<string>();
  const add = (s: CiteSource | null) => {
    if (!s || !s.href) return;
    const key = `${s.kind}:${s.href}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };
  for (const part of parts) {
    const p = part as { type?: unknown; state?: unknown; toolName?: unknown; input?: unknown; output?: unknown };
    if (p.state !== "output-available") continue;
    // A tool call the client knows is typed (`tool-read_note`); one it doesn't arrives as `dynamic-tool` with its name
    const name = typeof p.type === "string" && p.type.startsWith("tool-") ? p.type.slice(5) : p.type === "dynamic-tool" ? str(p.toolName) : undefined;
    if (!name) continue;
    const o = obj(p.output), i = obj(p.input);
    if (!o || "error" in o) continue;
    switch (name) {
      case "read_note": {
        const path = str(o.path), text = str(o.text);
        if (isNotePath(path) && text) { const n = parseNote(path, text); add(noteSource(path, n.title, snippetOf(n.body))); }
        break;
      }
      case "search_notes":
      case "list_notes": {
        for (const r of rows(o.results ?? o.notes)) {
          const path = str(r.path);
          if (isNotePath(path)) add(noteSource(path, str(r.title), str(r.snippet)));
        }
        break;
      }
      case "read_page": {
        const url = str(o.url), asked = str(i?.url);
        if (/^https?:/i.test(url)) add(pageSource(url, str(o.title), snippetOf(str(o.text)), asked && asked !== url ? [asked] : []));
        break;
      }
      case "read_url": {
        for (const r of rows(o.pages)) {
          const url = str(r.url);
          if (/^https?:/i.test(url)) add(pageSource(url, str(r.title), snippetOf(str(r.text))));
        }
        break;
      }
      case "web_search": {
        for (const r of rows(o.results)) {
          const url = str(r.url);
          if (/^https?:/i.test(url)) add(pageSource(url, str(r.title), excerpt(r.excerpts) || snippetOf(str(r.text))));
        }
        break;
      }
      case "read_attachment": {
        const path = str(i?.path), name = str(o.name);
        if (isNotePath(path) && name) add({ kind: "pdf", href: name, path, title: name, site: "PDF", ...(str(o.text) ? { snippet: snippetOf(str(o.text)) } : {}) });
        break;
      }
    }
  }
  return out;
}

const unwrap = (h: string) => h.trim().replace(/^<|>$/g, "");
const noHash = (h: string) => h.split("#")[0];
const norm = (h: string) => noHash(unwrap(h)).replace(/\/+$/, "");
const sameNote = (href: string, path: string) => norm(href).replace(/^\.\//, "") === path;
const sameFile = (href: string, name: string) => norm(href).split("/").pop() === name;
const asUrl = (u: string) => {
  try {
    const x = new URL(unwrap(u));
    if (x.protocol !== "http:" && x.protocol !== "https:") return null;
    return `${x.hostname.replace(WWW, "").toLowerCase()}${x.pathname.replace(/\/+$/, "")}${x.search}`;
  } catch {
    return null;
  }
};
const sameUrl = (a: string, b: string) => {
  const x = asUrl(a), y = asUrl(b);
  return x !== null && x === y;
};

/** Whether the answer names this source at `href`: an exact path for a note, the same address for a page (host and
 *  case ignored, `www.`, a fragment and a trailing slash dropped), the file name for a PDF. */
export function matchesSource(href: string, source: CiteSource): boolean {
  if (source.kind === "note") return sameNote(href, source.href);
  if (source.kind === "pdf") return sameFile(href, source.href);
  return sameUrl(href, source.href) || (source.also ?? []).some((u) => sameUrl(href, u));
}

const LINK = /(!?)\[[^\]]*\]\(\s*<?([^)\s>]+)/g;

/** The sources an answer cites, numbered in the order it first links them: a markdown link whose target names a source
 *  read this turn (`sources`), each counted once. An image link isn't a citation. */
export function citedIn(answer: string, sources: readonly CiteSource[]): Citation[] {
  const out: Citation[] = [], seen = new Set<string>();
  for (const m of answer.matchAll(LINK)) {
    if (m[1] === "!") continue;
    const source = sources.find((s) => matchesSource(m[2], s));
    if (!source) continue;
    const key = `${source.kind}:${source.href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...source, n: out.length + 1 });
  }
  return out;
}

/** The citation an answer link points at, for the renderer: the numbered source whose target is `href`, if any. */
export function findCite(href: string, cited: readonly Citation[]): Citation | undefined {
  return cited.find((c) => matchesSource(href, c));
}

/** A cited source's address to open: its note page (by the id in its path), its URL, or the attachment it names. */
export function citeLink(c: Citation): string {
  return c.kind === "page" ? c.url ?? c.href : c.kind === "note" ? `/note/${encodeURIComponent(noteIdOf(c.path ?? c.href))}` : c.href;
}
