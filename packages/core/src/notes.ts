// Notes as plain strings: the repo's .md files are the source of truth, so every edit here is a text
// edit the laptop and Claude read back unchanged. Frontmatter is the few keys the root CLAUDE.md lists,
// parsed by hand: a YAML library would rewrite what it doesn't understand.

import { firstUrl } from "./hyperlinks";
import { drawingPreview, isDrawing } from "./photos";

export const NOTES = "notes/";
export const ATTACHMENTS = "attachments/";
export const MEMORY = "agent/memory.md";
/** What a note made by "New note" is called until its owner types a title (the file is `-untitled.md`, which a retitle never renames). */
export const UNTITLED = "Untitled";
export const COLORS = ["yellow", "orange", "red", "pink", "purple", "blue", "teal", "green", "gray"] as const;
export type Color = (typeof COLORS)[number];

/** `archived`: out of the lists, still found by search, links and the agent's tools. Never pinned as well (archivePatch). */
type Flags = { pinned: boolean; archived: boolean; color?: Color; tags: string[] };
/** A one-tap edit of the flags: only what is passed changes; `null` takes a colour off. */
export type FlagEdit = Partial<Omit<Flags, "color">> & { color?: Color | null };
export type Note = { id: string; title: string; created: string; body: string } & Flags;
/** What serializeNote writes: the title always, `created` when known (a new note's maker gives it), the flags only when set. */
type Meta = { title: string; created: string } & Partial<Flags>;

/** What a note is: its record's `kind` column (server/pb_migrations/1793300000_note_kind.js), set when it is made and never
 *  changed. Never read off the path. The screenshot captures' old `capture` kind is no longer one: such a note reads as a
 *  note (noteKindOf). */
const NOTE_KINDS = ["note"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
/** A record's `kind` column as a NoteKind: one this client doesn't know yet (a kind added later) is shown as a note. */
export const noteKindOf = (v: unknown): NoteKind => ((NOTE_KINDS as readonly unknown[]).includes(v) ? (v as NoteKind) : "note");

/** One file per note, flat under notes/. */
export const isNotePath = (p: string) => /^notes\/[^/]+\.md$/.test(p);
/** The filename without `.md`: a note's stable id, also its attachments/ folder. */
export const noteIdOf = (p: string) => p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/, "");
/** `attachments/<note-id>/<name>` split up; null for anything else. */
export function attachmentOf(p: string): { noteId: string; name: string } | null {
  const m = /^attachments\/([^/]+)\/([^/]+)$/.exec(p);
  return m ? { noteId: m[1], name: m[2] } : null;
}

// ---- frontmatter

const KEYS = ["title", "created", "pinned", "archived", "color", "tags"] as const;
/** The keys a one-tap edit sets (withFlags): where both sides changed one, reconcile lets mine win. */
const FLAG_KEYS: readonly string[] = ["pinned", "archived", "color", "tags"];

type Front = { head: number; end: number; body: number; lines: string[]; eol: string };

/** The `---` block at the top: where its lines start (`head`), where the closing fence starts (`end`),
 *  where the body starts. null without one, or when it never closes (then it's all body). */
function front(text: string): Front | null {
  const m = /^﻿?---[ \t]*(\r?\n)/.exec(text);
  if (!m) return null;
  const lines: string[] = [];
  for (let at = m[0].length; ;) {
    const nl = text.indexOf("\n", at), line = text.slice(at, nl < 0 ? text.length : nl).replace(/\r$/, "");
    if (/^(---|\.\.\.)[ \t]*$/.test(line)) return { head: m[0].length, end: at, body: nl < 0 ? text.length : nl + 1, lines, eol: m[1] };
    if (nl < 0) return null;
    lines.push(line);
    at = nl + 1;
  }
}

/** Frontmatter lines grouped per key: a `key:` line and the indented `- item` lines under it. */
function entries(lines: string[]) {
  const out: { key: string | null; lines: string[] }[] = [];
  for (const l of lines) {
    const k = /^([A-Za-z_][\w-]*)[ \t]*:/.exec(l)?.[1] ?? null;
    if (k == null && out.length && /^([ \t]|-)/.test(l)) out[out.length - 1].lines.push(l);
    else out.push({ key: k, lines: [l] });
  }
  return out;
}

const rebuild = (text: string, f: Front, lines: string[]) => text.slice(0, f.head) + lines.map((l) => l + f.eol).join("") + text.slice(f.end);

const ESC: Record<string, string> = { n: "\n", t: "\t", r: "\r", "0": "\0" };

/** A quoted or plain scalar's value; a `# comment` after it dropped. */
function unquote(v: string): string {
  v = v.trim();
  if (v[0] === '"') {
    const m = /^"((?:[^"\\]|\\.)*)"/.exec(v);
    if (m) return m[1].replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c: string) => (c.length > 1 ? String.fromCharCode(parseInt(c.slice(1), 16)) : ESC[c] ?? c));
  }
  if (v[0] === "'") {
    const m = /^'((?:[^']|'')*)'/.exec(v);
    if (m) return m[1].replace(/''/g, "'");
  }
  return v.replace(/(^|\s+)#.*$/, "");
}

/** `[a, "b, c"]` → items, commas inside quotes kept. */
function flowList(v: string): string[] {
  const out: string[] = [], s = v.slice(1, -1);
  let cur = "", q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === '"' && c === "\\") cur += c + (s[++i] ?? "");
    else if (q) { if (c === q) q = null; cur += c; }
    else if ((c === '"' || c === "'") && !cur.trim()) { q = c; cur += c; }     // a quote opens only at an item's start
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map(unquote).filter(Boolean);
}

/** Plain when YAML reads it back as the same string, else double-quoted. */
function scalar(v: string): string {
  const plain = v !== "" && v === v.trim() && !/^[-?:,[\]{}#&*!|>'"%@`]/.test(v) && !/: |\s#|:$|[\n\r\t]/.test(v)
    && !/^(true|false|yes|no|on|off|null|~)$/i.test(v) && !/^[-+.]?\d[\d_.,:eE+-]*$/.test(v);
  return plain ? v : `"${v.replace(/[\\"]/g, "\\$&").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}"`;
}
const item = (v: string) => (/[,[\]{}]/.test(v) ? `"${v.replace(/[\\"]/g, "\\$&")}"` : scalar(v));

const truthy = (v: string) => /^(true|yes|on)$/i.test(unquote(v));

/** The slug part of an id, as words: `20261005-garage-door` → `Garage door`. */
function titleFromId(id: string) {
  const s = id.replace(/^\d{8}-/, "").replace(/-\d+$/, "").replace(/[-_]+/g, " ").trim() || id;
  return s[0].toUpperCase() + s.slice(1);
}

export function parseNote(path: string, text: string): Note {
  const id = noteIdOf(path), f = front(text), body = f ? text.slice(f.body) : text;
  const n: Note = { id, title: "", created: "", pinned: false, archived: false, tags: [], body };
  for (const e of f ? entries(f.lines) : []) {
    const v = e.lines[0].slice(e.lines[0].indexOf(":") + 1).trim();
    if (e.key === "title") n.title = unquote(v);
    else if (e.key === "created") n.created = unquote(v);
    else if (e.key === "pinned") n.pinned = truthy(v);
    else if (e.key === "archived") n.archived = truthy(v);
    else if (e.key === "color") { const c = unquote(v).toLowerCase() as Color; if (COLORS.includes(c)) n.color = c; }
    else if (e.key === "tags")
      n.tags = v.startsWith("[") && v.endsWith("]") ? flowList(v)
        : v ? [unquote(v)].filter(Boolean)
        : e.lines.slice(1).map((l) => unquote(l.replace(/^\s*-\s*/, ""))).filter(Boolean);    // a block list
  }
  if (!n.title) n.title = /^#[ \t]+(.+?)[ \t#]*$/m.exec(body)?.[1] ?? titleFromId(id);
  if (!n.created) { const d = /^(\d{4})(\d{2})(\d{2})-/.exec(id); if (d) n.created = `${d[1]}-${d[2]}-${d[3]}`; }
  return n;
}

/** The frontmatter lines serializeNote writes for one key, `\n`-joined; null when it leaves the key out. */
function lineFor(k: (typeof KEYS)[number], m: Meta): string | null {
  switch (k) {
    case "title": return `title: ${scalar(m.title.replace(/\s*\n\s*/g, " "))}`;
    // Whenever it is known: a new note's maker gives it (its day), a file read back has it from its frontmatter or its name;
    // one with neither gets none rather than the day it happened to be edited
    case "created": { const c = m.created; return c ? `created: ${/^\d{4}-\d{2}-\d{2}/.test(c) ? c : scalar(c)}` : null; }
    case "pinned": return m.pinned ? "pinned: true" : null;
    case "archived": return m.archived ? "archived: true" : null;
    case "color": return m.color ? `color: ${m.color}` : null;
    case "tags": return m.tags?.length ? `tags: [${m.tags.map(item).join(", ")}]` : null;
  }
}

export function serializeNote(meta: Meta, body: string): string {
  return `---\n${KEYS.map((k) => lineFor(k, meta)).filter((l) => l != null).join("\n")}\n---\n${body}`;
}

/** The file with a new body under its frontmatter as is: keys the laptop added, its quoting and its line ends stay. A
 *  retitle replaces the title line in place (withKeys), nothing else of the frontmatter. */
export function withBody(text: string, n: Note, body: string, title?: string): string {
  const kept = text.slice(0, text.length - n.body.length) + body;
  return title && title !== n.title ? withKeys(kept, { ...n, title, body }, ["title"]) : kept;
}

/** The note with these flags, edited in place (withKeys). `color: null` clears. */
export function withFlags(path: string, text: string, flags: FlagEdit): string {
  const set = Object.fromEntries(Object.entries(flags).filter(([, v]) => v !== undefined));
  const n = parseNote(path, text), next: Note = {
    ...n, ...set, color: flags.color === null ? undefined : (flags.color ?? n.color)
  };
  return withKeys(text, next, Object.keys(set));
}

/** `text` with these keys' lines as serializeNote would write them from `next`, in place: other frontmatter lines (keys
 *  the laptop added, its quoting, its line ends) stay as they are; a file serializeNote wrote comes out as serializeNote
 *  would write it. */
function withKeys(text: string, next: Note, keys: readonly string[]): string {
  const f = front(text);
  if (!f) return serializeNote(next, next.body);
  const es = entries(f.lines);
  for (const k of KEYS.filter((k) => keys.includes(k))) {
    const line = lineFor(k, next), i = es.findIndex((e) => e.key === k);
    if (i >= 0) { if (line == null) es.splice(i, 1); else es[i] = { key: k, lines: line.split("\n") }; continue; }
    if (line == null) continue;
    const before = KEYS.slice(0, KEYS.indexOf(k)) as readonly string[];
    const at = es.reduce((a, e, j) => (e.key && before.includes(e.key) ? j + 1 : a), 0);
    es.splice(at, 0, { key: k, lines: line.split("\n") });
  }
  return rebuild(text, f, es.flatMap((e) => e.lines));
}

/** `text` with `from`'s flag lines in place of its own, at the same spots among the other keys. */
function withFlagLinesOf(text: string, from: string): string {
  const a = front(text), b = front(from);
  if (!a || !b) return text;
  const at = new Map<number, string[]>();
  let k = 0;
  for (const e of entries(b.lines)) if (e.key && FLAG_KEYS.includes(e.key)) at.set(k, [...(at.get(k) ?? []), ...e.lines]); else k++;
  const out: string[] = [];
  let i = 0;
  for (const e of entries(a.lines)) {
    if (e.key && FLAG_KEYS.includes(e.key)) continue;
    out.push(...(at.get(i) ?? []), ...e.lines);
    i++;
  }
  for (const [j, ls] of at) if (j >= i) out.push(...ls);
  return rebuild(text, a, out);
}

// ---- ids

const GREEK: Record<string, string> = {
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x",
  ο: "o", π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
};

/** ASCII, lowercase, dashes, max 40: `Κωδικοί γκαράζ` → `kodikoi-gkaraz`. Tonos and other accents dropped first. */
export function slugify(title: string): string {
  const s = title.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC")
    .replace(/[α-ως]/g, (c) => GREEK[c] ?? c).replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s.slice(0, 40).replace(/-+$/, "") || "note";
}

const two = (n: number) => String(n).padStart(2, "0");

/** `notes/YYYYMMDD-<slug>.md` for a new note made at `now` (ms), its local day; `-2`, `-3` when the path is taken. */
export function newNotePath(title: string, now: number, taken: Set<string> = new Set()): string {
  const d = new Date(now), stem = `${NOTES}${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${slugify(title)}`;
  let p = `${stem}.md`;
  for (let i = 2; taken.has(p); i++) p = `${stem}-${i}.md`;
  return p;
}

// ---- body

/** Inline markdown as the words a reader sees, in one pass so an escape (`\*`) is never taken for a mark: escapes
 *  read as their character; an image goes, a link is its words, an autolink its address; emphasis, strikethrough
 *  and code marks come off. */
const INLINE = /\\([\\`*_{}[\]()#+\-.!|<>~"'&:])|!\[(?:\\.|[^\]\\])*\]\([^)]*\)|\[((?:\\.|[^\]\\])*)\]\([^)]*\)|<([a-z][a-z0-9+.-]*:[^>\s]+)>|\*\*|__|~~|`|\*([^\s*](?:[^*]*[^\s*])?)\*/gi;
function inlineText(s: string): string {
  return s.replace(INLINE, (_m, esc?: string, link?: string, auto?: string, em?: string) => esc ?? (link != null ? inlineText(link) : auto ?? (em != null ? inlineText(em) : "")));
}

/** One line of markdown as plain text: a quote, bullet, number, task box or heading marker off its start (an empty
 *  item is nothing), then the inline marks. */
function plainLine(l: string): string {
  const t = l.trim().replace(/^>\s*/, "").replace(/^#{1,6}\s+/, "").replace(/^([-*+]|\d+[.)])(\s+|$)(\[[ xX]\](\s+|$))?/, "");
  return inlineText(t).replace(/\s+/g, " ").trim();
}

const SKIPPED = /^(```|~~~|<!--)|^([-*_]\s*){3,}$|^\|?[\s:|-]+\|[\s:|-]*$/;       // a fence, comment, rule or table's divider row

/** Markdown as the text it reads as, line by line: nothing of the syntax left, nothing dropped but fences, rules and
 *  table dividers. `prose`: only what a preview wants, so headings and code go too. The lines, blank ones left out. */
function plainLines(md: string, prose = false): string[] {
  const out: string[] = [];
  let fence = false;
  for (const raw of md.split("\n")) {
    const l = raw.trim();
    if (/^(```|~~~)/.test(l)) fence = !fence;
    if (SKIPPED.test(l) || (prose && (fence || /^#{1,6}\s/.test(l)))) continue;
    const t = plainLine(l);
    if (t) out.push(t);
  }
  return out;
}

/** ~160 characters of prose for the list: headings, images, rules, code and blank lines skipped; a bullet
 *  or a task reads as its text, a link as its words. */
export function snippetOf(body: string, max = 160): string {
  const out: string[] = [];
  let len = 0;
  for (const t of plainLines(body, true)) {
    out.push(t);
    if ((len += t.length + 1) > max) break;
  }
  const s = out.join(" ");
  if (s.length <= max) return s;
  const cut = s.slice(0, max), sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:]+$/, "") + "…";
}

/** One picture a note's tile can show: a photo (`image`: the name in the note's attachments folder) or a PDF (`pdf`:
 *  the name; its first page, as the agent renders it). A drawing is the PNG kept beside it (photos.ts `drawingPreview`), an
 *  image like a photo, marked `drawing` so a client can show it whole rather than cropped. */
type TilePicture = { image: string; drawing?: true } | { pdf: string };
/** What stands for a note in a list: up to `max` of its photos, PDFs and drawings in the body's order, `more` how many it has
 *  past those; with none, the first web link in it (`link`: the page, whose picture the server's link preview finds).
 *  null: neither. */
type Pictures = { pictures: TilePicture[]; more: number } | { link: string };

/** How many pictures a tile shows at most: the mosaic's four cells. */
const MOSAIC_MAX = 4;

export function picturesOf(noteId: string, body: string, max = MOSAIC_MAX): Pictures | null {
  const all: TilePicture[] = [], seen = new Set<string>();
  rewriteImagePaths(body, noteId, (name) => {
    if (seen.has(name)) return undefined;
    seen.add(name);
    if (/\.(jpe?g|png|webp|gif)$/i.test(name)) all.push({ image: name });
    else if (/\.pdf$/i.test(name)) all.push({ pdf: name });
    else if (isDrawing(name) && !seen.has(drawingPreview(name))) { seen.add(drawingPreview(name)); all.push({ image: drawingPreview(name), drawing: true }); }
    return undefined;
  });
  if (all.length) return { pictures: all.slice(0, max), more: Math.max(0, all.length - max) };
  let fence = false;
  const prose = body.split("\n").filter((l) => {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return false; }
    return !fence;                                                          // a URL in a code block is code
  });
  const link = firstUrl(prose.join("\n"));
  return link ? { link } : null;
}

/** A mosaic cell, as fractions of the picture area: left, top, width, height. */
type Cell = { x: number; y: number; w: number; h: number };

/** The cells of a tile's mosaic for `n` pictures (1 to MOSAIC_MAX), as social apps lay them out: one fills it, two
 *  split it down the middle, three are one tall on the left and two stacked on the right, four are quarters. */
export function mosaicCells(n: number): Cell[] {
  const half = 0.5;
  switch (Math.min(Math.max(n, 1), MOSAIC_MAX)) {
    case 1: return [{ x: 0, y: 0, w: 1, h: 1 }];
    case 2: return [{ x: 0, y: 0, w: half, h: 1 }, { x: half, y: 0, w: half, h: 1 }];
    case 3: return [{ x: 0, y: 0, w: half, h: 1 }, { x: half, y: 0, w: half, h: half }, { x: half, y: half, w: half, h: half }];
    default: return [{ x: 0, y: 0, w: half, h: half }, { x: half, y: 0, w: half, h: half }, { x: 0, y: half, w: half, h: half }, { x: half, y: half, w: half, h: half }];
  }
}

/** A tile shows the title above the body, so a body that opens with that same title as `# ` loses it. */
export function dropTitle(body: string, title: string) {
  const m = /^\s*#\s+(.+?)\s*#*\s*(?:\n|$)/.exec(body);
  return m && m[1].trim().toLowerCase() === title.trim().toLowerCase() ? body.slice(m[0].length) : body;
}

const isItem = (l: string) => /^\s*([-*+]|\d+[.)])\s/.test(l);
const blank = (l: string) => !l.trim();

/** The body with `text` added, as the agent's append_to_note and a clip to a note save it and its confirm card
 *  previews it. appendToNote makes one line a bullet itself, so a line already written as one (`- [ ] milk`) loses its
 *  own marker first. */
export function appended(body: string, text: string, section?: string) {
  const t = text.trim();
  return appendToNote(body, t.includes("\n") ? t : t.replace(/^[-*+]\s+/, ""), section);
}

/** A bullet (a paragraph when `text` spans lines) at the end of `## section`, which is added at the end when
 *  missing; without a section, at the end of the body. Only adds: the rest of the body stays byte for byte. */
export function appendToNote(body: string, text: string, section?: string): string {
  const t = text.trim(), block = (t.includes("\n") ? t : `- ${t}`).split("\n");
  const lines = body.split("\n");
  let h = -1, e = lines.length, fence = false;
  if (section) {
    const name = section.trim().replace(/^#+\s*/, "").toLowerCase();
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence;
      if (fence || !/^#{1,2}\s/.test(lines[i])) continue;
      if (h >= 0) { e = i; break; }
      if (/^##\s/.test(lines[i]) && lines[i].replace(/^##\s+/, "").replace(/[\s#]+$/, "").toLowerCase() === name) h = i;
    }
    if (h < 0) {
      const b = body.trimEnd();
      return `${b ? `${b}\n\n` : ""}## ${section.trim().replace(/^#+\s*/, "")}\n\n${block.join("\n")}\n`;
    }
  }
  let last = -1;
  for (let i = h + 1; i < e; i++) if (!blank(lines[i])) last = i;
  // After the last written line; in an empty section one blank line under the heading
  let at: number, pre: string[];
  if (last >= 0) { at = last + 1; pre = isItem(lines[last]) && isItem(block[0]) ? [] : [""]; }
  else if (h >= 0) { at = h + 1 < lines.length && blank(lines[h + 1]) ? h + 2 : h + 1; pre = at === h + 1 ? [""] : []; }
  else { at = 0; pre = []; }
  const rest = lines.slice(at);
  const post = !rest.length ? [""] : !blank(rest[0]) ? [""] : [];   // end the file with a newline; a blank line before what follows
  return [...lines.slice(0, at), ...pre, ...block, ...post, ...rest].join("\n");
}

/** This note's attachment references (`../attachments/<id>/<name>`, `attachments/<id>/<name>`) pointed at
 *  whatever `resolve` gives for the name (a file:// URI of the cached copy); left alone when it gives nothing. */
export function rewriteImagePaths(body: string, noteId: string, resolve: (name: string) => string | undefined): string {
  const id = noteId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return body.replace(new RegExp(`(?<![\\w./-])(?:\\.\\.?\\/|\\/)?attachments\\/${id}\\/([^\\s)"'<>]+)`, "g"), (all, name: string) => {
    let n = name;
    try { n = decodeURIComponent(name); } catch { /* a stray % */ }
    return resolve(n) ?? all;
  });
}

// ---- search

/** What search compares: lowercase, accents and Greek tonos gone, the text and the query folded the same way.
 *  Length-preserving for precomposed text. */
export const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC").toLowerCase();

// ---- merge

type Hunk = { s: number; e: number; lines: string[] };       // base lines [s, e) became `lines`

/** The lines `a[a0..a1)` and `b[b0..b1)` have in common, in order, as runs `[i, j, len]` (a run of `len` lines from
 *  `a[i]` and `b[j]`): Myers' O(ND) diff in linear space, by its middle snake, so a long note costs time by how much
 *  changed and memory by how long it is. */
function common(a: string[], b: string[], a0: number, a1: number, b0: number, b1: number, out: [number, number, number][]): void {
  let p = 0;
  while (a0 + p < a1 && b0 + p < b1 && a[a0 + p] === b[b0 + p]) p++;
  if (p) out.push([a0, b0, p]);
  a0 += p; b0 += p;
  let q = 0;
  while (q < a1 - a0 && q < b1 - b0 && a[a1 - 1 - q] === b[b1 - 1 - q]) q++;
  a1 -= q; b1 -= q;
  if (a0 < a1 && b0 < b1) {
    const [x0, y0, x1, y1] = middle(a, b, a0, a1, b0, b1);
    common(a, b, a0, x0, b0, y0, out);
    if (x1 > x0) out.push([x0, y0, x1 - x0]);
    common(a, b, x1, a1, y1, b1, out);
  }
  if (q) out.push([a1, b1, q]);
}

/** The middle snake of the shortest edit script between two non-empty ranges (Myers 1986, section 4b): the diagonal run
 *  `[x0, y0]` to `[x1, y1]` (absolute indexes) the forward and the backward search meet on. */
function middle(a: string[], b: string[], a0: number, a1: number, b0: number, b1: number): [number, number, number, number] {
  const n = a1 - a0, m = b1 - b0, delta = n - m, odd = (delta & 1) === 1, half = Math.ceil((n + m) / 2) + 1;
  const off = half, fwd = new Int32Array(2 * half + 2), bwd = new Int32Array(2 * half + 2);
  for (let d = 0; d <= half; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && fwd[off + k - 1] < fwd[off + k + 1]) ? fwd[off + k + 1] : fwd[off + k - 1] + 1;
      const sx = x, sy = x - k;
      let y = sy;
      while (x < n && y < m && a[a0 + x] === b[b0 + y]) { x++; y++; }
      fwd[off + k] = x;
      if (odd && k >= delta - (d - 1) && k <= delta + (d - 1) && x + bwd[off + delta - k] >= n) return [a0 + sx, b0 + sy, a0 + x, b0 + y];
    }
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && bwd[off + k - 1] < bwd[off + k + 1]) ? bwd[off + k + 1] : bwd[off + k - 1] + 1;
      const sx = x, sy = x - k;
      let y = sy;
      while (x < n && y < m && a[a1 - 1 - x] === b[b1 - 1 - y]) { x++; y++; }
      bwd[off + k] = x;
      if (!odd && k >= delta - d && k <= delta + d && x + fwd[off + delta - k] >= n) return [a1 - x, b1 - y, a1 - sx, b1 - sy];
    }
  }
  throw new Error("diff: no middle snake");
}

/** The edits from `a` to `b`: the lines they don't have in common (`common`). */
function hunks(a: string[], b: string[]): Hunk[] {
  const runs: [number, number, number][] = [];
  common(a, b, 0, a.length, 0, b.length, runs);
  runs.push([a.length, b.length, 0]);
  const out: Hunk[] = [];
  let i = 0, j = 0;
  for (const [x, y, len] of runs) {
    if (x > i || y > j) out.push({ s: i, e: x, lines: b.slice(j, y) });
    i = x + len; j = y + len;
  }
  return out;
}

/** `long` is `short` with lines added before or after it, or with its last line typed on. */
function extends_(long: string[], short: string[]): boolean {
  if (short.length === 0) return true;
  const n = short.length, k = long.length - n;
  if (k < 0) return false;
  const at = (o: number) => short.every((l, i) => long[o + i] === l || (i === n - 1 && o + i < long.length && long[o + i].startsWith(l)));
  return at(0) || at(k);
}

/** Line-based 3-way merge: both sides' edits to `base`, or null where they change the same lines. */
export function merge3(base: string, mine: string, theirs: string): string | null {
  const o = base.split("\n"), out: string[] = [];
  const hs = [...hunks(o, mine.split("\n")), ...hunks(o, theirs.split("\n"))].sort((x, y) => x.s - y.s || x.e - y.e);
  let at = 0, prev: Hunk | null = null;
  for (const h of hs) {
    const same = prev && h.s === prev.s && h.e === prev.e;
    if (same && h.lines.join("\n") === prev!.lines.join("\n")) continue;     // the same edit on both sides
    if (same) {
      // Typing that went on after a save the other side already has: both grew the lines they replaced, one further than
      // the other, and the longer wins. Anything else, a shrink against a growth included, is two different edits.
      const [short, long] = extends_(h.lines, prev!.lines) ? [prev!.lines, h.lines] : [h.lines, prev!.lines];
      if (!extends_(long, short) || !extends_(short, o.slice(h.s, h.e))) return null;
      out.splice(out.length - prev!.lines.length, prev!.lines.length, ...long);
      continue;
    }
    if (h.s < at) return null;                                                // overlap
    out.push(...o.slice(at, h.s), ...h.lines);
    at = h.e; prev = h;
  }
  return [...out, ...o.slice(at)].join("\n");
}

/** The note as it was before an edit (`before`) put back over what is there now (`current`), when `after` is what the edit
 *  wrote: the inverse of the edit, merged into everything written since. null where the owner's later writing touches
 *  the same lines: the edit can no longer be undone without losing theirs. */
export const undoEdit = (before: string, after: string, current: string): string | null => merge3(after, before, current);

/** The editor's draft when the stored body moved on under it (a pull, a merge on push, an agent append): both
 *  edits against `start`, the body it began from. Overlap keeps the draft as typed, `clash` set to say so. */
export function mergeDraft(start: string, draft: string, theirs: string): { text: string; clash: boolean } {
  if (theirs === start || theirs === draft) return { text: draft, clash: false };
  const m = merge3(start, draft, theirs);
  return m == null ? { text: draft, clash: true } : { text: m, clash: false };
}

/** Both sides edited a note: mine with theirs folded in, or null when the edits overlap. The flags
 *  (pinned, archived, color, tags) are one-tap toggles: where both sides' flag lines collide, mine win them
 *  and the rest still merges. Edits that don't collide keep both sides' flags. */
export function reconcile(base: string | undefined, mine: string, theirs: string): string | null {
  if (theirs === mine) return mine;
  const m = base == null ? null : merge3(base, mine, theirs);
  if (m != null) return m;
  const t = withFlagLinesOf(theirs, mine);
  if (t === mine) return mine;
  return base == null ? null : merge3(withFlagLinesOf(base, mine), mine, t);
}

/** Multi-line Markdown pasted into an empty note's title, split: its first line becomes the title (a heading's `#`s
 *  dropped) and the rest the body, as written. A single line (or nothing past the first) is `null`: just a title. */
export function pastedNote(text: string): { title: string; body: string } | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const first = lines.findIndex((l) => l.trim());
  if (first < 0) return null;
  const body = lines.slice(first + 1).join("\n").replace(/^\s*\n/, "").trimEnd();
  if (!body.trim()) return null;
  const title = lines[first].trim().replace(/^#{1,6}\s+/, "").replace(/\s+#+$/, "").trim();
  return { title, body };
}
