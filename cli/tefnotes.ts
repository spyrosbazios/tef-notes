#!/usr/bin/env bun
// TEF Notes from a terminal: notes and tasks, for you and for coding agents. Same client as the phone
// (packages/core/src/client/pocketbase.ts), so writes are compare-and-swap on rev: nothing here writes over an edit it hasn't
// seen. The server's address is kept in ${XDG_STATE_HOME:-~/.local/state}/tefnotes/server.json.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { exportPlan, fileNameOf } from "@/core/handoff";
import { appendToNote, COLORS, isNotePath, MEMORY, newNotePath, parseNote, reconcile, serializeNote, type Color } from "@/core/notes";
import { recordId } from "@/core/client/ids";
import * as pb from "@/core/client/pocketbase";
import { type Remote, Conflict, landed } from "@/core/record-contracts";
import { backlinks, linksForNextRound, linksFrom, newLink, notesOfTask, type Link, type LinkEnd } from "@/core/record-links";
import { complete, nextOrder, newTask, patchTask, views, type Task, type TaskPatch } from "@/core/todo";
import { sceneProblem } from "@/core/drawing";
import { drawingName, drawingPreview, fileMarkdown, isDrawingName, linkPath, type Photo } from "@/core/photos";
import { localDay } from "@/core/days";
import { type Server, photoUrl, serverUrl } from "@/core/server-urls";
import { markOf, writer } from "./writes";

const HELP = `tefnotes — the notes on the server

  tefnotes server <url>             where the notes are (there is no sign-in: the server must only be reachable over a private network)
  tefnotes ls [tag]                 notes, pinned first then newest: id · title · [tags] · pinned|archived
  tefnotes tags                     the defined tags: name · colour · description
  tefnotes tag <name> [options]     a tag defined, or its definition changed: --color <colour>  --about <text>
  tefnotes rename-tag <old> <new>   a tag renamed on every note, task and lens; a <new> already defined merges them
                                   colours: ${COLORS.join(" ")}
  tefnotes tags --describe          descriptions the server's model writes from each tag's notes, printed, not saved
      --write                      ... and saved as the tags' descriptions (replaces the ones there)
  tefnotes cat <id>                 a note's whole file; its rev goes to stderr
  tefnotes links <id>               what is linked to or from a note: ← task <task-id> · title · role (a task about it), → note <id> · role
  tefnotes grep <words…>            notes holding every word
  tefnotes search <words…>          notes by their words and meaning, best first (the agent's search):
                                   id · title · words|meaning|both · snippet  (needs the server's agent)
  tefnotes new <title> [< body]     a new note, body from stdin; prints its id
  tefnotes append <id> [< text]     text added at the end (one line becomes a bullet)
  tefnotes put <id> <rev> [< file]  the whole file replaced, if still at <rev> (from cat)
  tefnotes edit <id>                in $EDITOR; edits made meanwhile are merged in
  tefnotes rm <id> <rev>            deleted, photos and all, if still at <rev>
  tefnotes draw <id> <file|-> [options]
                                   an Excalidraw scene (.excalidraw JSON) added to the note as a drawing, with a PNG
                                   the server draws of it; prints its name
      --label <text>               the link's text (default Drawing)   --replace <name.excalidraw>  that drawing's
                                   scene and picture replaced instead, the note's text left as it is
  tefnotes memory                   the in-app agent's memory file
  tefnotes export <dir>             every note as <dir>/notes/<file>.md, and the photos and PDFs they link as
                                   <dir>/attachments/<note-id>/<name>: the layout the notes' own links expect
  tefnotes import <dir>             every .md under <dir> as a note (an export, or any folder of Markdown), with the
                                   files its links point at as attachments; a note whose id is taken is skipped
      --dry-run                    only print what would happen    --update  a taken one is overwritten instead

  tefnotes today                    tasks to do today (and overdue), then this evening's
  tefnotes tasks [view]             inbox | today | upcoming | logbook (default inbox):
                                   task id · title · dates · checklist ticked/all · tags · about <note ids>
  tefnotes add <title> [options]    a task, to the Inbox; prints its id
      --when <day>  --evening   --due <day>  --every <1d|2w|1m|1y|+3d|mon,thu>  --remind <HH:MM>
      --note <id> (repeat for several: the notes it is about)   --tag <name> (repeat)   --notes <text>
                                   <day>: YYYY-MM-DD, today or tomorrow
  tefnotes set <task-id> [options]  a task changed: --title <text>, and add's options but --note; "none" clears
                                   a value (--when none), --tag replaces the tags (--tag none: no tags)
  tefnotes drop <task-id>           the task deleted (its links go with it)
  tefnotes link <task-id> <id…>     the task made about these notes (already linked ones stay as they are)
  tefnotes unlink <task-id> <id…>   the task is no longer about these notes
  tefnotes done <task-id>           the task ticked (a repeating one gets its next round); an id's first letters do

<id>: 20261005-lidl, notes/20261005-lidl.md, or "memory".

TEF_NOTES_AGENT=1: every note, task and tag description written (new, append, put, edit, draw, import, add, set, done, tag,
tags --write) is marked as an outside agent's: a note or task \`tainted\`, so the in-app assistant treats it like web text and
asks before writing once it has read it; a description \`describedBy: agent\`, so it isn't taken for the owner's. Deletions,
links and tag renames carry no mark. Coding agents run with it (skills/tefnotes).`;

const DIR = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "tefnotes"), SERVER = join(DIR, "server.json");

/** Every write that carries content goes through this, marked when TEF_NOTES_AGENT=1 (writes.ts). */
const write = writer(markOf(process.env));

const die = (msg: string): never => { console.error(`tefnotes: ${msg}`); process.exit(1); };

function server(): Server {
  if (!existsSync(SERVER)) die("no server set: tefnotes server <url>");
  return JSON.parse(readFileSync(SERVER, "utf8"));
}

const pathOf = (id: string) => (id === "memory" ? MEMORY : /^(notes|agent)\//.test(id) ? id : `notes/${id.replace(/\.md$/, "")}.md`);
const idOf = (path: string) => path.replace(/^notes\//, "").replace(/\.md$/, "");

async function stdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  return await new Response(Bun.stdin.stream()).text();
}

async function need(s: Server, id: string): Promise<Remote> {
  return (await pb.read(s, pathOf(id))) ?? die(`no note ${pathOf(id)}`);
}

/** Thrown, not `die`d: a caller that has uploaded files for the edit takes them back down before the process ends (main's catch prints it). */
const gone = (path: string): never => { throw new Error(`${path} was deleted meanwhile`); };

/** Write `next(current text)` until it lands on a rev nobody moved meanwhile. A write whose answer never came may have landed:
 *  the note is read again and, when it is past the rev written over and already holds the change, that is the answer; an edit that
 *  adds (append, a drawing's link) is never made a second time on top of itself. */
async function change(s: Server, id: string, next: (text: string) => string): Promise<Remote> {
  for (let tries = 0; tries < 3; tries++) {
    const cur = await need(s, id), text = next(cur.text);
    try { return (await write.notes.update(s, cur, text)) ?? gone(cur.path); } catch (e) {
      if (e instanceof Conflict) continue;
      if (!pb.unanswered(e)) throw e;
      const now = await pb.read(s, cur.path);
      if (!now) gone(cur.path);
      if (now!.rev !== cur.rev && landed(cur.text, text, now!.text)) return now!;
    }
  }
  throw new Error("the note keeps changing under this edit; try again");
}

/** `tefnotes draw`: the scene and the server's PNG of it uploaded as the note's drawing (core/photos.ts: the scene linked, the
 *  PNG found beside it by name), then a line linking it appended; or, with --replace, an existing drawing's two files swapped. */
async function draw(s: Server, a: string[]) {
  const usage = "tefnotes draw <id> <file.excalidraw|-> [--label <text>] [--replace <name.excalidraw>]";
  const { words, opt } = options(a, []), [id, file] = words;
  if (!id || !file) die(usage);
  const scene = file === "-" ? await stdin() : existsSync(file!) ? readFileSync(file!, "utf8") : die(`no file ${file}`);
  let json: unknown;
  try { json = JSON.parse(scene); } catch { die(`${file} isn't JSON`); }
  const problem = sceneProblem(json);
  if (problem) die(`${file}: ${problem}`);
  const note = await need(s, id!), noteId = parseNote(note.path, note.text).id;
  const png = await pb.drawingPicture(s, scene), blob = new Blob([scene], { type: "application/json" });
  const have = await pb.attachments.list(s, noteId), replace = opt.get("replace");
  if (replace !== undefined) {
    if (!isDrawingName(replace) || !have.some((p) => p.name === replace)) die(`${idOf(note.path)} has no drawing ${replace}; it has: ${have.filter((p) => isDrawingName(p.name)).map((p) => p.name).join(", ") || "none"}`);
    if (!note.text.includes(linkPath(noteId, replace))) die(`${idOf(note.path)} doesn't link ${replace}: nothing replaced`);
    // The new scene goes up first, under a name of its own (a note's file names are unique: the next free one of the old name's
    // stem), the note's link is moved to it at the rev read, and only then the old two files go: whatever fails on the way,
    // the old drawing is still there and linked.
    const stem = replace.replace(/\.excalidraw$/i, "").replace(/-\d+$/, ""), name = drawingName(stem, new Set(have.map((p) => p.name)));
    const up = await pb.attachments.upload(s, noteId, name, blob);
    let pre: Photo | undefined;
    try {
      pre = await pb.attachments.upload(s, noteId, drawingPreview(name), png);
      await change(s, id!, (t) => t.split(linkPath(noteId, replace)).join(linkPath(noteId, name)));
    } catch (e) { for (const p of [up, pre]) if (p) await pb.attachments.remove(s, p.rec); throw e; }
    for (const p of have) if (p.name === replace || p.name === drawingPreview(replace)) await pb.attachments.remove(s, p.rec);
    return console.log(name);
  }
  const label = opt.get("label")?.trim() || "Drawing", name = drawingName(label, new Set(have.map((p) => p.name)));
  const up = await pb.attachments.upload(s, noteId, name, blob);
  try { await pb.attachments.upload(s, noteId, drawingPreview(name), png); } catch (e) { await pb.attachments.remove(s, up.rec); throw e; }  // never a scene without its picture
  const r = await change(s, id!, (t) => `${t.trimEnd()}\n\n${fileMarkdown(noteId, name, label)}\n`);
  console.error(`linked at the end, rev ${r.rev}`);
  console.log(name);
}

/** `fn` over `items`, a few at a time: every note is a request, and a notebook is some hundreds. */
async function inBatches<T, R>(items: T[], fn: (x: T) => Promise<R>, size = 8): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

/** Every note and the attachments its body links, written under `dir`. An existing file there is overwritten. */
async function exportAll(s: Server, dir: string) {
  const entries = (await pb.list(s)).filter((e) => isNotePath(e.path));
  const notes = (await inBatches(entries, (e) => pb.get(s, e.rec))).flatMap((n) => (n && isNotePath(n.path) ? [n] : []));   // one deleted meanwhile is skipped
  const plan = exportPlan(notes, await pb.attachments.list(s));
  const put = (rel: string, data: string | Uint8Array) => { const file = join(dir, rel); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, data); };
  for (const e of plan) put(`notes/${fileNameOf(e.path)}`, e.text);
  const files = plan.flatMap((e) => e.files);
  await inBatches(files, async (f) => {
    const r = await fetch(photoUrl(s, f.photo));
    if (!r.ok) die(`${f.path}: HTTP ${r.status}`);
    put(f.path, new Uint8Array(await r.arrayBuffer()));
  });
  console.error(`${plan.length} notes and ${files.length} attachments in ${dir}`);
}

/** Every file under `dir`, relative with `/`; dot folders and node_modules skipped. */
function walk(dir: string, root = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.name.startsWith(".") || d.name === "node_modules") return [];
    const full = join(dir, d.name);
    return d.isDirectory() ? walk(full, root) : d.isFile() ? [relative(root, full).split(sep).join("/")] : [];
  });
}

/** A folder of Markdown in as notes (core `importNotes`), each note's fate printed as it is decided. */
async function importAll(s: Server, dir: string, dry: boolean, update: boolean) {
  if (!existsSync(dir)) die(`no folder ${dir}`);
  const t = await write.importNotes(s, { paths: walk(dir), text: async (f) => readFileSync(join(dir, f), "utf8"), blob: async (f) => Bun.file(join(dir, f)) },
    { dry, update, today: localDay(Date.now()), onLine: (l) => console.log(`${l.what.padEnd(6)}  ${l.from} -> ${l.id}${l.what === "skip" ? " (taken)" : l.files ? ` (${l.files} files)` : ""}`) });
  console.error(dry ? `${t.found} notes found, ${t.taken} already there; nothing written (--dry-run)`
    : `${t.made} new, ${t.updated} updated, ${t.same} unchanged, ${t.skipped} skipped; ${t.files} attachments`);
}

const GREP_LIMIT = 20;
const TASK_VIEWS = ["inbox", "today", "upcoming", "logbook"] as const;
type View = (typeof TASK_VIEWS)[number];

const taskLine = (t: Task, notes: string[] = []) => [t.id, t.title, t.evening && "this evening",
  t.when && `when ${t.when}`, t.due && `due ${t.due}`, t.every && `every ${t.every}`, t.remind && `remind ${t.remind}`,
  t.done && `done ${t.done}`, t.checklist.length && `${t.checklist.filter((i) => i.done).length}/${t.checklist.length} ticked`,
  t.tags.length && `tags ${t.tags.join(", ")}`, notes.length && `about ${notes.join(", ")}`].filter(Boolean).join(" · ");

/** Note record id -> its id as the commands take it (`20261005-lidl`). */
async function noteIds(s: Server): Promise<Map<string, string>> {
  return new Map((await pb.list(s)).map((e) => [e.rec, idOf(e.path)]));
}

async function showTasks(s: Server, view: View) {
  const v = views(await pb.tasks.list(s), localDay(Date.now()));
  const list = view === "today" ? [...v.today, ...v.evening] : view === "upcoming" ? v.upcoming.flatMap((d) => d.tasks) : v[view];
  const [links, notes] = list.length ? [await pb.links.list(s), await noteIds(s)] : [[], new Map<string, string>()];
  for (const t of list) console.log(taskLine(t, notesOfTask(links, t.id).flatMap((n) => notes.get(n) ?? [])));
}

/** What is linked to or from a note: tasks about it first, then the rest. */
async function showLinks(s: Server, id: string) {
  const rec = (await need(s, id)).rec, end: LinkEnd = { type: "note", id: rec };
  const [all, notes, tasks] = [await pb.links.of(s, end), await noteIds(s), await pb.tasks.list(s)], title = new Map(tasks.map((t) => [t.id, t.title]));
  const name = (e: LinkEnd) => (e.type === "note" ? notes.get(e.id) : e.type === "task" ? [e.id, title.get(e.id)].filter(Boolean).join(" · ") : e.id) ?? e.id;
  const line = (arrow: string, l: Link, e: LinkEnd) => [`${arrow} ${e.type} ${name(e)}`, l.role].join(" · ");
  for (const l of backlinks(all, rec).sort((a, b) => +(b.from.type === "task") - +(a.from.type === "task"))) console.log(line("←", l, l.from));
  for (const l of linksFrom(all, end)) console.log(line("→", l, l.to));
}

/** Tasks about notes: `ids` are note ids; each is made (link) or dropped (unlink). Idempotent both ways. */
async function linkNotes(s: Server, ref: string, ids: string[], drop: boolean) {
  const task = await taskBy(s, ref), end: LinkEnd = { type: "task", id: task.id };
  const recs = await Promise.all(ids.map(async (id) => (await need(s, id)).rec)), had = await pb.links.from(s, end);
  for (const rec of recs) {
    const to: LinkEnd = { type: "note", id: rec };
    if (!drop) { await pb.links.add(s, newLink(recordId(), end, to, "about")); continue; }
    for (const l of had.filter((x) => x.role === "about" && x.to.type === "note" && x.to.id === rec)) await pb.links.remove(s, l.id);
  }
  console.error(`${drop ? "unlinked" : "linked"} ${recs.length} note${recs.length === 1 ? "" : "s"}`);
}

/** A task by id, or by the start of one that no other shares. */
async function taskBy(s: Server, ref: string): Promise<Task> {
  const all = await pb.tasks.list(s), hits = all.filter((t) => t.id === ref);
  const found = hits.length ? hits : all.filter((t) => t.id.startsWith(ref));
  return found.length === 1 ? found[0] : die(found.length ? `${ref} starts several tasks: use more of the id` : `no task ${ref} (ids: tefnotes tasks)`);
}

/** The record id of a repeating task's next round: made from the task's own id, so the same tick run twice makes one round. */
const nextRoundId = (task: string) => BigInt(`0x${createHash("sha256").update(`next-round:${task}`).digest("hex").slice(0, 24)}`).toString(36).padStart(15, "0").slice(0, 15);

/** `--key value` and bare `--flag` options, and the words left over. */
function options(a: string[], flags: string[]): { words: string[]; opt: Map<string, string>; all: Map<string, string[]> } {
  const words: string[] = [], opt = new Map<string, string>(), all = new Map<string, string[]>();
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith("--")) { words.push(a[i]); continue; }
    const k = a[i].slice(2), v = flags.includes(k) ? "" : a[++i] ?? die(`--${k} needs a value`);
    opt.set(k, v);
    all.set(k, [...(all.get(k) ?? []), v]);                  // a repeated option keeps every value (`opt` the last)
  }
  return { words, opt, all };
}

/** A colour by name; "none" takes it off. */
const colorOf = (v: string): Color | undefined => (v === "none" ? undefined : (COLORS as readonly string[]).includes(v) ? (v as Color) : die(`no colour ${v}: ${COLORS.join(", ")}`));

/** A task's fields from `add`'s and `set`'s options; "none" clears one. */
function taskPatch(opt: Map<string, string>, all: Map<string, string[]>): TaskPatch {
  const val = (k: string) => (opt.get(k) === "none" ? "" : opt.get(k)!);
  const dayOf = (k: string) => (opt.get(k) === "none" ? "" : day(opt.get(k)!));
  const tags = all.get("tag")?.filter((t) => t !== "none");
  return {
    ...(opt.has("when") && { when: dayOf("when") }), ...(opt.has("due") && { due: dayOf("due") }),
    ...(opt.has("every") && { every: val("every") }), ...(opt.has("remind") && { remind: val("remind") }),
    ...(opt.has("evening") && { evening: true }), ...(opt.has("no-evening") && { evening: false }),
    ...(opt.has("notes") && { notes: val("notes") }), ...(tags && { tags }),
  };
}

const day = (v: string) => (v === "today" ? localDay(Date.now()) : v === "tomorrow" ? localDay(Date.now() + 86_400_000) : v);

async function edit(s: Server, id: string) {
  const was = await need(s, id);
  // The note's text in a folder of its own (owner-only), never a predictable name another user could read or replace; removed
  // once the text is saved, kept and named whenever it isn't.
  const dir = mkdtempSync(join(tmpdir(), "tefnotes-")), file = join(dir, `${idOf(was.path).replace(/\//g, "_")}.md`);
  writeFileSync(file, was.text, { mode: 0o600 });
  chmodSync(file, 0o600);
  const keep = (why: string): never => die(`${why}; your text is in ${file}`);
  const ed = Bun.spawnSync([...(process.env.VISUAL || process.env.EDITOR || "vi").split(" "), file], { stdio: ["inherit", "inherit", "inherit"] });
  if (ed.exitCode !== 0) keep(`editor exited ${ed.exitCode}; nothing saved`);
  const mine = readFileSync(file, "utf8"), done = (said: string) => { rmSync(dir, { recursive: true, force: true }); console.error(said); };
  if (mine === was.text) return done("unchanged");
  try {
    try {
      const r = (await write.notes.update(s, was, mine)) ?? keep(`${was.path} was deleted meanwhile`);
      return done(`saved, rev ${r.rev}`);
    } catch (e) {
      if (!(e instanceof Conflict)) throw e;
    }
    const theirs = await need(s, id), merged = reconcile(was.text, mine, theirs.text);
    if (merged == null) keep("changed on another device meanwhile, and the edits overlap");
    const r = (await write.notes.update(s, theirs, merged!)) ?? keep(`${was.path} was deleted meanwhile`);
    done(`merged with an edit made meanwhile, saved, rev ${r.rev}`);
  } catch (e) {
    keep(e instanceof Conflict ? "changed again while it was being merged" : e instanceof Error ? e.message : String(e));
  }
}

async function main(argv: string[]) {
  const [cmd, ...a] = argv;
  if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") return console.log(HELP);
  if (cmd === "server") {
    const s = { url: serverUrl(a[0] ?? die("tefnotes server <url>")) };
    await pb.list(s);                                      // reachable, and a notes server, before it's kept
    mkdirSync(DIR, { recursive: true });
    writeFileSync(SERVER, JSON.stringify(s));
    return console.error(`notes at ${s.url}`);
  }
  const s = server();
  switch (cmd) {
    case "ls": {
      const tag = a[0]?.toLowerCase();
      for (const c of await pb.index(s)) {
        if (tag && !c.tags.some((t) => t.toLowerCase() === tag)) continue;
        console.log([idOf(c.path), c.title, c.tags.length ? `[${c.tags.join(", ")}]` : "", c.archived ? "archived" : c.pinned && "pinned"].filter(Boolean).join(" · "));
      }
      return;
    }
    case "tags": {
      const { opt } = options(a, ["describe", "write"]);
      if (opt.has("write") && !opt.has("describe")) die("--write goes with --describe");
      const defs = await pb.tags.list(s);
      if (!opt.has("describe")) {
        for (const t of defs) console.log([t.name, t.color ?? "", t.description].filter(Boolean).join(" · "));
        return;
      }
      const described = await pb.tags.describeAll(s);   // a failure is the server's words (main's catch)
      for (const { tag, description } of described) {
        const def = defs.find((d) => d.name === tag);
        if (opt.has("write") && def) await write.tags.update(s, def, { name: def.name, color: def.color, description });
        console.log(`${tag} · ${description}`);
      }
      if (opt.has("write")) console.error(`saved ${described.length} description${described.length === 1 ? "" : "s"}`);
      return;
    }
    case "cat": case "memory": {
      const r = await need(s, cmd === "memory" ? "memory" : a[0] ?? die("tefnotes cat <id>"));
      process.stdout.write(r.text);
      return console.error(`rev ${r.rev}`);
    }
    case "links": return showLinks(s, a[0] ?? die("tefnotes links <id>"));
    case "grep": {
      const found = await pb.search(s, a.join(" "), GREP_LIMIT + 1);
      for (const r of found.slice(0, GREP_LIMIT)) console.log(`${idOf(r.path)} · ${parseNote(r.path, r.text).title}`);
      if (found.length > GREP_LIMIT) console.error(`only the first ${GREP_LIMIT} matches (newest edit first) are listed: more notes match; use more words`);
      return;
    }
    case "new": {
      const title = a.join(" ").trim() || die("tefnotes new <title> [< body]");
      const body = (await stdin()).trimEnd(), taken = new Set((await pb.list(s)).map((e) => e.path));
      // One record id for the note, whatever path it ends up at. A path taken meanwhile (made on the phone this very moment)
      // is a Conflict that made nothing under the id, so the next free path goes under the same one; and a create whose answer
      // was lost is sent again by `write.notes.create` under it, never as a second note.
      const rec = recordId();
      for (;;) {
        const path = newNotePath(title, Date.now(), taken);
        try {
          await write.notes.create(s, rec, path, serializeNote({ title, created: localDay(Date.now()) }, body ? `${body}\n` : ""));
          return console.log(idOf(path));
        } catch (e) {
          if (!(e instanceof Conflict)) throw e;
          taken.add(path);
        }
      }
    }
    case "draw": return draw(s, a);
    case "append": {
      const id = a[0] ?? die("tefnotes append <id> [< text]"), text = (await stdin()).trim() || die("nothing on stdin to append");
      const r = await change(s, id, (t) => { const n = parseNote(pathOf(id), t); return t.slice(0, t.length - n.body.length) + appendToNote(n.body, text); });
      return console.error(`appended, rev ${r.rev}`);
    }
    case "put": {
      const [id, rev] = a;
      if (!id || !rev || !/^\d+$/.test(rev)) die("tefnotes put <id> <rev> [< file]   (rev: from tefnotes cat)");
      const text = await stdin();
      if (!text.trim()) die("nothing on stdin: an empty note would replace the whole text (rm deletes a note)");
      const cur = await need(s, id);
      try {
        const r = (await write.notes.update(s, { ...cur, rev: Number(rev) }, text)) ?? die(`${cur.path} was deleted meanwhile`);
        return console.error(`saved, rev ${r.rev}`);
      } catch (e) {
        if (e instanceof Conflict) die(`${cur.path} is at rev ${cur.rev} now, not ${rev}: cat it again and redo the change`);
        throw e;
      }
    }
    case "edit": return edit(s, a[0] ?? die("tefnotes edit <id>"));
    case "rm": {
      const [id, rev] = a;
      if (!id || !rev || !/^\d+$/.test(rev)) die("tefnotes rm <id> <rev>   (rev: from tefnotes cat)");
      const cur = await need(s, id);
      try { await pb.remove(s, { rec: cur.rec, rev: Number(rev) }); } catch (e) {
        if (e instanceof Conflict) die(`${cur.path} is at rev ${cur.rev} now, not ${rev}: it changed since you read it`);
        throw e;
      }
      return console.error(`deleted ${cur.path}`);
    }
    case "export": return exportAll(s, a[0] ?? die("tefnotes export <dir>"));
    case "import": {
      const { words, opt } = options(a, ["dry-run", "update"]);
      return importAll(s, words[0] ?? die("tefnotes import <dir> [--dry-run] [--update]"), opt.has("dry-run"), opt.has("update"));
    }
    case "today": return showTasks(s, "today");
    case "tasks": {
      const view = (a[0] ?? "inbox") as View;
      if (!TASK_VIEWS.includes(view)) die(`tefnotes tasks [${TASK_VIEWS.join("|")}]`);
      return showTasks(s, view);
    }
    case "add": {
      const { words, opt, all } = options(a, ["evening"]), title = words.join(" ").trim() || die("tefnotes add <title> [--when <day> --due <day> --every … --remind HH:MM --evening --note <id>… --tag <name>… --notes <text>]");
      const fields: TaskPatch & { title: string } = { ...taskPatch(opt, all), title };
      const notes = await Promise.all([...new Set(all.get("note") ?? [])].map(async (id) => (await need(s, id)).rec));   // every note must exist before the task is made
      if (fields.evening && !fields.when) die("--evening needs --when");
      fields.order = nextOrder(await pb.tasks.list(s));
      // One id for the task: a create sent again after a lost answer finds it taken and is the same task (`write.tasks.create`).
      const task = (await write.tasks.create(s, newTask(recordId(), fields))).id;
      for (const rec of notes) await pb.links.add(s, newLink(recordId(), { type: "task", id: task }, { type: "note", id: rec }, "about"));
      return console.log(task);
    }
    case "done": {
      const ref = a[0] ?? die("tefnotes done <task-id>   (ids from tefnotes tasks)");
      for (let tries = 0; tries < 3; tries++) {
        const cur = await pb.tasks.get(s, (await taskBy(s, ref)).id);
        if (!cur) return die(`task ${ref} was deleted meanwhile`);
        const { rev, ...was } = cur, { task, next } = complete(was, localDay(Date.now()), () => nextRoundId(cur.id));
        if (task === was) return console.error("already done");
        // The next round first, then the tick: a run that dies between the two leaves the task open with its next round made,
        // and the run again finds that round (its id is the task's) and ticks. Ticking first would lose the round.
        if (next) {
          const made = await write.tasks.create(s, next);
          for (const l of linksForNextRound(await pb.links.from(s, { type: "task", id: cur.id }), cur.id, made.id, recordId)) await pb.links.add(s, l);
          console.error(`next round ${made.id}`);
        }
        try {
          const r = (await write.tasks.update(s, cur.id, rev, task)) ?? die(`task ${ref} was deleted meanwhile`);
          return console.error(`done, rev ${r.rev}`);
        } catch (e) {
          if (!(e instanceof Conflict)) throw e;
        }
      }
      return die("the task keeps changing under this edit; try again");
    }
    case "set": {
      const { words, opt, all } = options(a, ["evening", "no-evening"]);
      const ref = words[0] ?? die("tefnotes set <task-id> [--title … --when <day> --due <day> --every … --remind HH:MM --evening|--no-evening --tag <name>… --notes <text>]");
      if (all.has("note")) die("a task's notes are links: tefnotes link / unlink");
      const patch: TaskPatch = { ...taskPatch(opt, all), ...(opt.has("title") && { title: opt.get("title")!.trim() || die("--title can't be empty") }) };
      if (!Object.keys(patch).length) die("nothing to change: give an option");
      for (let tries = 0; tries < 3; tries++) {
        const cur = (await pb.tasks.get(s, (await taskBy(s, ref)).id)) ?? die(`task ${ref} was deleted meanwhile`);
        const { rev, ...was } = cur;
        let next: Task;
        try { next = patchTask(was, patch); } catch (e) { return die((e as Error).message); }
        try {
          const r = (await write.tasks.update(s, cur.id, rev, next)) ?? die(`task ${ref} was deleted meanwhile`);
          return console.error(`saved, rev ${r.rev}`);
        } catch (e) {
          if (!(e instanceof Conflict)) throw e;
        }
      }
      return die("the task keeps changing under this edit; try again");
    }
    case "drop": {
      const t = await taskBy(s, a[0] ?? die("tefnotes drop <task-id>")), cur = (await pb.tasks.get(s, t.id)) ?? die(`task ${a[0]} was deleted meanwhile`);
      try { await pb.tasks.remove(s, cur.id, cur.rev); } catch (e) {
        if (e instanceof Conflict) die(`task ${cur.id} changed just now: look at it again (tefnotes tasks) before deleting`);
        throw e;
      }
      return console.error(`deleted ${cur.id} · ${cur.title}`);
    }
    case "search": {
      const q = a.join(" ").trim() || die("tefnotes search <words…>");
      for (const h of await pb.searchByMeaning(s, q, 15)) console.log([idOf(h.path), h.title, h.match, h.snippet.replace(/\s+/g, " ")].filter(Boolean).join(" · "));
      return;
    }
    case "tag": {
      const { words, opt } = options(a, []), name = words.join(" ").trim() || die(`tefnotes tag <name> [--color <${COLORS.join("|")}>] [--about <text>]`);
      const color = opt.has("color") ? colorOf(opt.get("color")!) : undefined;
      const had = (await pb.tags.list(s)).find((d) => d.name.toLowerCase() === name.toLowerCase());
      if (had) {
        await write.tags.update(s, had, { name: had.name, color: opt.has("color") ? color : had.color, description: opt.get("about") ?? had.description });
        return console.error(`changed ${had.name}`);
      }
      await write.tags.create(s, { name, color, description: opt.get("about") ?? "" });
      return console.error(`defined ${name}`);
    }
    case "rename-tag": {
      const [from, to, ...rest] = a;
      if (!from || !to || rest.length) die("tefnotes rename-tag <old> <new>");
      const r = await pb.tags.rename(s, from, to);
      return console.error(`${r.merged ? "merged" : "renamed"} ${from} into ${r.tag}: ${r.notes} notes, ${r.tasks} tasks, ${r.lenses} lenses`);
    }
    case "link": case "unlink": {
      const [ref, ...ids] = a;
      if (!ref || !ids.length) die(`tefnotes ${cmd} <task-id> <note-id…>`);
      return linkNotes(s, ref, ids, cmd === "unlink");
    }
    default: die(`no command ${cmd}\n\n${HELP}`);
  }
}

main(process.argv.slice(2)).catch((e) => die(e instanceof Error ? e.message : String(e)));
