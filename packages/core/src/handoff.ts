// Notes handed to the chat agent, and notes written out as files — what the phone, the web app and the CLI do the same
// way with a set of notes. Pure: no DOM import.
import { ATTACHMENTS, NOTES, noteIdOf, parseNote, rewriteImagePaths, serializeNote, slugify } from "./notes";
import type { Photo } from "./pocketbase";

/** A note named in a message: its path, and the title it was named by. */
export type NoteRef = { path: string; title: string };

const named = (n: NoteRef) => `“${n.title.trim() || noteIdOf(n.path)}” (${n.path})`;

/** The opening of a chat about these notes, put before the owner's question when it is sent. It names each by title and
 *  path: the agent's notes index (the `<context>` block) lists notes by path and `read_note` takes one, so no field travels
 *  beside the message and the agent reads the notes before it answers. The web shows them as chips (`askedAbout`). */
export function aboutNotes(notes: NoteRef[]): string {
  if (!notes.length) return "";
  if (notes.length === 1) return `About my note ${named(notes[0])}: `;
  return `About these notes:\n${notes.map((n) => `- ${named(n)}`).join("\n")}\n\n`;
}

const ONE = /^About my note “(.*?)” \((notes\/[^)\s]+\.md)\): ?/s;
const MANY = /^About these notes:\n((?:- .*\n)+)\n/;
const ITEM = /^- “(.*)” \((notes\/[^)\s]+\.md)\)$/;

/** `aboutNotes`' inverse: the notes a message opens by naming, and the owner's own words after them. */
export function askedAbout(text: string): { notes: NoteRef[]; rest: string } {
  const one = ONE.exec(text);
  if (one) return { notes: [{ title: one[1], path: one[2] }], rest: text.slice(one[0].length) };
  const many = MANY.exec(text);
  if (many) {
    const notes = many[1].trimEnd().split("\n").map((l) => ITEM.exec(l));
    if (notes.every((m) => m)) return { notes: notes.map((m) => ({ title: m![1], path: m![2] })), rest: text.slice(many[0].length) };
  }
  return { notes: [], rest: text };
}

/** A chat's first message asking the agent to change one note, sent as it stands (the note screen's assistant box). It
 *  names the note as `aboutNotes` does, so the agent reads it with its own tools, and the owner's words follow the colon
 *  unchanged; the write comes back as a confirm card on the Ask tab. */
export function editNote(note: NoteRef, instruction: string): string {
  return `Edit my note ${named(note)}, changing only what I ask: ${instruction.trim()}`;
}

/** What a note's file is called when it leaves the app: the basename of its path. */
export const fileNameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** A note written out whole, with the photos and PDFs its body points at. */
export type ExportEntry = { path: string; text: string; files: { photo: Photo; path: string }[] };

/** Where each note and attachment goes in an export: `notes/<file>.md` and `attachments/<note-id>/<name>`, the layout
 *  the notes' own links (`../attachments/<note-id>/<name>`) expect, so the files read the same outside the app. Only
 *  the attachments a body links are kept: a record no line points at is an orphan. */
export function exportPlan(notes: { path: string; text: string }[], photos: Photo[]): ExportEntry[] {
  const by = new Map<string, Photo>();
  for (const p of photos) by.set(`${p.note}/${p.name}`, p);
  return notes.map((n) => {
    const id = noteIdOf(n.path), files: ExportEntry["files"] = [];
    rewriteImagePaths(n.text, id, (name) => {
      const photo = by.get(`${id}/${name}`);
      if (photo && !files.some((f) => f.photo === photo)) files.push({ photo, path: `${ATTACHMENTS}${id}/${photo.name}` });
      return undefined;                                          // only looking: the text goes out as it is
    });
    return { path: n.path, text: n.text, files };
  });
}

/** A note to make from a folder of Markdown: its path here, its text with links to files beside it pointed at its own
 *  attachments, and those files (`from`: where it is in the folder; `name`: what it is called under the note). */
export type ImportEntry = { from: string; path: string; text: string; files: { from: string; name: string }[] };

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const LINK = /(!?\[(?:\\.|[^\]\\])*\]\()(<[^>]+>|[^)\s]+)((?:\s+"[^"]*")?\))/g;

/** `a/b/../c/./d` as `a/c/d`; null when it climbs out of the folder. */
function normal(p: string): string | null {
  const out: string[] = [];
  for (const s of p.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") { if (!out.pop()) return null; } else out.push(s);
  }
  return out.join("/");
}

/** The stem of a file as a note id: kept when it is already one (an export's), else its slug; `-2`, `-3` when taken. */
function idFor(rel: string, taken: Set<string>): string {
  const stem = fileNameOf(rel).replace(/\.md$/i, ""), base = /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(stem) ? stem : slugify(stem);
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  taken.add(id);
  return id;
}

/** A folder of Markdown as notes: `exportPlan`'s inverse, and any other folder of `.md` files. Every `.md` outside
 *  `attachments/` is a note, named by its file; a link or image whose target is a file in the folder becomes the note's
 *  attachment, and the link points at it the way the app's own do (`../attachments/<id>/<name>`), so an export comes back
 *  byte for byte. A file without frontmatter gets a title (its heading, else its name) and `created` (`today`).
 *  `files`: every path in the folder, relative, with `/`. */
export function importPlan(notes: { from: string; text: string }[], files: Set<string>, today: string): ImportEntry[] {
  const ids = new Set<string>();
  return notes.filter((n) => !n.from.startsWith(ATTACHMENTS)).map((n) => {
    const id = idFor(n.from, ids), path = `${NOTES}${id}.md`, dir = n.from.includes("/") ? n.from.slice(0, n.from.lastIndexOf("/") + 1) : "";
    const out: ImportEntry["files"] = [], names = new Map<string, string>();
    const body = n.text.replace(LINK, (all, open: string, target: string, close: string) => {
      const raw = target.startsWith("<") ? target.slice(1, -1) : target;
      if (SCHEME.test(raw) || raw.startsWith("#") || /\.md(#.*)?$/i.test(raw)) return all;
      let dec = raw;
      try { dec = decodeURIComponent(raw); } catch { /* a stray % */ }
      const at = normal(dec.startsWith("/") ? dec : dir + dec);
      if (at == null || !files.has(at)) return all;
      let name = names.get(at);
      if (!name) {
        const file = fileNameOf(at).replace(/[/\\]/g, "_"), dot = file.lastIndexOf("."), used = new Set(names.values());
        name = file;
        for (let i = 2; used.has(name); i++) name = dot > 0 ? `${file.slice(0, dot)}-${i}${file.slice(dot)}` : `${file}-${i}`;
        names.set(at, name);
        out.push({ from: at, name });
      }
      return `${open}../${ATTACHMENTS}${id}/${encodeURIComponent(name)}${close}`;
    });
    const text = /^---\r?\n/.test(body) ? body : serializeNote({ title: parseNote(path, body).title, created: today }, body);
    return { from: n.from, path, text, files: out };
  });
}
