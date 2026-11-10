// The note format, for the hooks that write notes themselves (autotag.pb.js, clip.pb.js): goja can't import the
// clients' TypeScript, so what follows mirrors packages/core/src/notes.ts (front, entries, unquote, flowList, scalar, item,
// parseNote, serializeNote, withFlags for `tags`, slugify, newNotePath, appendToNote, fold), pocketbase.ts
// (noteColumns) and photos.ts (photoName, linkPath). The clients and the server must write a note identically, or the
// phone's 3-way merge sees a change that isn't one: change them together. test/notes.test.js compares the two.

const NOTES = "notes/";
const MEMORY = "agent/memory.md";
const COLORS = ["yellow", "orange", "red", "pink", "purple", "blue", "teal", "green", "gray"];
const KEYS = ["title", "created", "pinned", "color", "tags"];

/** Accents and Greek tonos off: the combining marks NFD splits out (goja's regexp: the range, not \p{M}). */
const unmark = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC");

/** Case and Greek tonos folded away, as the clients compare tag names. */
const fold = (s) => unmark(s).toLowerCase();

const two = (n) => String(n).padStart(2, "0");
/** `YYYY-MM-DD`, local time (the container's TZ, docker-compose.yml). */
const localDay = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };

// ---- frontmatter

/** The `---` block at the top: where its lines start (`head`), where the closing fence starts (`end`), where the body
 *  starts. null without one, or when it never closes. */
function front(text) {
  const m = /^﻿?---[ \t]*(\r?\n)/.exec(text);
  if (!m) return null;
  const lines = [];
  for (let at = m[0].length; ;) {
    const nl = text.indexOf("\n", at), line = text.slice(at, nl < 0 ? text.length : nl).replace(/\r$/, "");
    if (/^(---|\.\.\.)[ \t]*$/.test(line)) return { head: m[0].length, end: at, body: nl < 0 ? text.length : nl + 1, lines, eol: m[1] };
    if (nl < 0) return null;
    lines.push(line);
    at = nl + 1;
  }
}

/** Frontmatter lines grouped per key: a `key:` line and the indented `- item` lines under it. */
function entries(lines) {
  const out = [];
  for (const l of lines) {
    const m = /^([A-Za-z_][\w-]*)[ \t]*:/.exec(l), k = m ? m[1] : null;
    if (k == null && out.length && /^([ \t]|-)/.test(l)) out[out.length - 1].lines.push(l);
    else out.push({ key: k, lines: [l] });
  }
  return out;
}

const ESC = { n: "\n", t: "\t", r: "\r", "0": "\0" };

/** A quoted or plain scalar's value; a `# comment` after it dropped. */
function unquote(v) {
  v = v.trim();
  if (v[0] === '"') {
    const m = /^"((?:[^"\\]|\\.)*)"/.exec(v);
    if (m) return m[1].replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c) => (c.length > 1 ? String.fromCharCode(parseInt(c.slice(1), 16)) : ESC[c] !== undefined ? ESC[c] : c));
  }
  if (v[0] === "'") {
    const m = /^'((?:[^']|'')*)'/.exec(v);
    if (m) return m[1].replace(/''/g, "'");
  }
  return v.replace(/(^|\s+)#.*$/, "");
}

/** `[a, "b, c"]` → items, commas inside quotes kept. */
function flowList(v) {
  const out = [], s = v.slice(1, -1);
  let cur = "", q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === '"' && c === "\\") cur += c + (s[++i] || "");
    else if (q) { if (c === q) q = null; cur += c; }
    else if ((c === '"' || c === "'") && !cur.trim()) { q = c; cur += c; }       // a quote opens only at an item's start
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map(unquote).filter(Boolean);
}

/** Plain when YAML reads it back as the same string, else double-quoted. */
function scalar(v) {
  const plain = v !== "" && v === v.trim() && !/^[-?:,[\]{}#&*!|>'"%@`]/.test(v) && !/: |\s#|:$|[\n\r\t]/.test(v)
    && !/^(true|false|yes|no|on|off|null|~)$/i.test(v) && !/^[-+.]?\d[\d_.,:eE+-]*$/.test(v);
  return plain ? v : `"${v.replace(/[\\"]/g, "\\$&").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}"`;
}
const item = (v) => (/[,[\]{}]/.test(v) ? `"${v.replace(/[\\"]/g, "\\$&")}"` : scalar(v));

const truthy = (v) => /^(true|yes|on)$/i.test(unquote(v));

/** The slug part of a note's id, as words: `20261005-garage-door` → `Garage door`. */
function titleFromId(id) {
  const s = id.replace(/^\d{8}-/, "").replace(/-\d+$/, "").replace(/[-_]+/g, " ").trim() || id;
  return s[0].toUpperCase() + s.slice(1);
}

/** A note's id: its path's file name without `.md`, the folder its attachments live under. */
const idOf = (path) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");

/** A note's frontmatter and body, as parseNote reads them. */
function parse(path, text) {
  const id = idOf(path), f = front(text), body = f ? text.slice(f.body) : text;
  const n = { id, title: "", created: "", pinned: false, color: undefined, tags: [], body };
  for (const e of f ? entries(f.lines) : []) {
    const v = e.lines[0].slice(e.lines[0].indexOf(":") + 1).trim();
    if (e.key === "title") n.title = unquote(v);
    else if (e.key === "created") n.created = unquote(v);
    else if (e.key === "pinned") n.pinned = truthy(v);
    else if (e.key === "color") { const c = unquote(v).toLowerCase(); if (COLORS.includes(c)) n.color = c; }
    else if (e.key === "tags") {
      n.tags = v.startsWith("[") && v.endsWith("]") ? flowList(v)
        : v ? [unquote(v)].filter(Boolean)
        : e.lines.slice(1).map((l) => unquote(l.replace(/^\s*-\s*/, ""))).filter(Boolean);    // a block list
    }
  }
  if (!n.title) { const h = /^#[ \t]+(.+?)[ \t#]*$/m.exec(body); n.title = h ? h[1] : titleFromId(id); }
  if (!n.created) { const d = /^(\d{4})(\d{2})(\d{2})-/.exec(id); if (d) n.created = `${d[1]}-${d[2]}-${d[3]}`; }
  return n;
}

/** The frontmatter line serializeNote writes for one key; null when it leaves the key out. */
function lineFor(k, m) {
  switch (k) {
    case "title": return `title: ${scalar(m.title.replace(/\s*\n\s*/g, " "))}`;
    case "created": { const c = m.created || localDay(); return `created: ${/^\d{4}-\d{2}-\d{2}/.test(c) ? c : scalar(c)}`; }
    case "pinned": return m.pinned ? "pinned: true" : null;
    case "color": return m.color ? `color: ${m.color}` : null;
    case "tags": return m.tags && m.tags.length ? `tags: [${m.tags.map(item).join(", ")}]` : null;
  }
  return null;
}

/** A whole note file: the frontmatter serializeNote writes, then `body`. */
const serialize = (meta, body) => `---\n${KEYS.map((k) => lineFor(k, meta)).filter((l) => l != null).join("\n")}\n---\n${body}`;

/** `text` with its tags line set to `tags`, the rest of the frontmatter as it was (the keys the laptop added, its
 *  quoting): withFlags(path, text, { tags }). */
function withTags(path, text, tags) {
  const f = front(text), n = parse(path, text);
  if (!f) return serialize({ ...n, tags }, n.body);
  const line = lineFor("tags", { tags }), es = entries(f.lines), i = es.findIndex((e) => e.key === "tags");
  if (i >= 0) { if (line == null) es.splice(i, 1); else es[i] = { key: "tags", lines: [line] }; }
  else if (line != null) {
    const before = KEYS.slice(0, KEYS.indexOf("tags"));
    es.splice(es.reduce((a, e, j) => (e.key && before.includes(e.key) ? j + 1 : a), 0), 0, { key: "tags", lines: [line] });
  }
  return text.slice(0, f.head) + es.flatMap((e) => e.lines).map((l) => l + f.eol).join("") + text.slice(f.end);
}

/** `text` with a new body under its frontmatter as it is (withBody without a retitle). */
const withBody = (text, n, body) => text.slice(0, text.length - n.body.length) + body;

/** The record's columns: `text` and the copies of its frontmatter every client writes beside it (noteColumns). */
function columns(path, text) {
  const n = parse(path, text);
  return { path, text, title: n.title, day: /^\d{4}-\d{2}-\d{2}$/.test(n.created) ? n.created : "", pinned: n.pinned,
    color: n.color || "", tags: n.tags };
}

// ---- ids

const GREEK = {
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x",
  ο: "o", π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
};

/** ASCII, lowercase, dashes, max 40: `Κωδικοί γκαράζ` → `kodikoi-gkaraz`. */
function slugify(title) {
  const s = unmark(title.toLowerCase())
    .replace(/[α-ως]/g, (c) => GREEK[c] || c).replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s.slice(0, 40).replace(/-+$/, "") || "note";
}

/** `notes/YYYYMMDD-<slug>` for a new note, local date: the path is this plus `.md`, or `-2.md`, `-3.md`... */
const pathStem = (title, now = Date.now()) => { const d = localDay(now).replace(/-/g, ""); return `${NOTES}${d}-${slugify(title)}`; };

/** The stem's first free path, given the paths taken. */
function newNotePath(title, now = Date.now(), taken = new Set()) {
  const stem = pathStem(title, now);
  let p = `${stem}.md`;
  for (let i = 2; taken.has(p); i++) p = `${stem}-${i}.md`;
  return p;
}

// ---- photos (packages/core/src/photos.ts)

const ATTACHMENTS = "attachments/";

/** `YYYYMMDD-HHMMSS.jpg`, local time; `-2`, `-3` when the note has that one already. */
function photoName(at, taken = new Set()) {
  const d = new Date(at);
  const stem = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
  let n = `${stem}.jpg`;
  for (let i = 2; taken.has(n); i++) n = `${stem}-${i}.jpg`;
  return n;
}

/** What a body's image line points at, after `../`. */
const linkPath = (noteId, name) => `${ATTACHMENTS}${noteId}/${name}`;

// ---- body

const isItem = (l) => /^\s*([-*+]|\d+[.)])\s/.test(l);
const blank = (l) => !l.trim();

/** A bullet (a paragraph when `text` spans lines) at the end of `## section`, which is added at the end when missing;
 *  without a section, at the end of the body. Only adds: the rest of the body stays byte for byte. */
function appendToNote(body, text, section) {
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
  let at, pre;
  if (last >= 0) { at = last + 1; pre = isItem(lines[last]) && isItem(block[0]) ? [] : [""]; }
  else if (h >= 0) { at = h + 1 < lines.length && blank(lines[h + 1]) ? h + 2 : h + 1; pre = at === h + 1 ? [""] : []; }
  else { at = 0; pre = []; }
  const rest = lines.slice(at);
  const post = !rest.length ? [""] : !blank(rest[0]) ? [""] : [];
  return [...lines.slice(0, at), ...pre, ...block, ...post, ...rest].join("\n");
}

/** What the agent's append_to_note saves (packages/core/src/notes.ts `appended`): one line loses a bullet marker of
 *  its own, since appendToNote makes it one. */
function appended(body, text, section) {
  const t = text.trim();
  return appendToNote(body, t.includes("\n") ? t : t.replace(/^[-*+]\s+/, ""), section);
}

module.exports = { NOTES, MEMORY, fold, localDay, idOf, parse, serialize, withTags, withBody, columns, slugify, pathStem, newNotePath, photoName, linkPath, appendToNote, appended };
