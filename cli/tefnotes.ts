#!/usr/bin/env bun
// TEF Notes from a terminal: notes and tasks, for you and for coding agents. Same client as the phone
// (packages/core/src/pocketbase.ts), so writes are compare-and-swap on rev: nothing here writes over an edit it hasn't
// seen. The server's address is kept in ${XDG_STATE_HOME:-~/.local/state}/tefnotes/server.json.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { exportPlan, fileNameOf } from "@/core/handoff";
import { importNotes } from "@/core/import";
import { appendToNote, isNotePath, MEMORY, newNotePath, parseNote, reconcile, serializeNote } from "@/core/notes";
import * as pb from "@/core/pocketbase";
import { backlinks, linksForNextRound, linksFrom, newLink, notesOfTask, type Link, type LinkEnd } from "@/core/record-links";
import { complete, nextOrder, newTask, views, type Task, type TaskPatch } from "@/core/todo";
import { describeAllTags, describeError, listTags, updateTag } from "@/core/tags";
import { localDay } from "@/core/time";

const HELP = `tefnotes — the notes on the server

  tefnotes server <url>             where the notes are (there is no sign-in: the server must only be reachable over a private network)
  tefnotes ls [tag]                 notes, pinned first then newest: id · title · [tags] · pinned
  tefnotes tags                     the defined tags: name · colour · description
  tefnotes tags --describe          descriptions the server's model writes from each tag's notes, printed, not saved
      --write                      ... and saved as the tags' descriptions (replaces the ones there)
  tefnotes cat <id>                 a note's whole file; its rev goes to stderr
  tefnotes links <id>               what is linked to or from a note: ← task <task-id> · title · role (a task about it), → note <id> · role
  tefnotes grep <words…>            notes holding every word
  tefnotes new <title> [< body]     a new note, body from stdin; prints its id
  tefnotes append <id> [< text]     text added at the end (one line becomes a bullet)
  tefnotes put <id> <rev> [< file]  the whole file replaced, if still at <rev> (from cat)
  tefnotes edit <id>                in $EDITOR; edits made meanwhile are merged in
  tefnotes rm <id> <rev>            deleted, photos and all, if still at <rev>
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
      --note <id> (repeat for several: the notes it is about)
                                   <day>: YYYY-MM-DD, today or tomorrow
  tefnotes link <task-id> <id…>     the task made about these notes (already linked ones stay as they are)
  tefnotes unlink <task-id> <id…>   the task is no longer about these notes
  tefnotes done <task-id>           the task ticked (a repeating one gets its next round); an id's first letters do

<id>: 20261005-lidl, notes/20261005-lidl.md, or "memory".`;

const DIR = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "tefnotes"), SERVER = join(DIR, "server.json");

const die = (msg: string): never => { console.error(`tefnotes: ${msg}`); process.exit(1); };

function server(): pb.Server {
  if (!existsSync(SERVER)) die("no server set: tefnotes server <url>");
  return JSON.parse(readFileSync(SERVER, "utf8"));
}

const pathOf = (id: string) => (id === "memory" ? MEMORY : /^(notes|agent)\//.test(id) ? id : `notes/${id.replace(/\.md$/, "")}.md`);
const idOf = (path: string) => path.replace(/^notes\//, "").replace(/\.md$/, "");

async function stdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  return await new Response(Bun.stdin.stream()).text();
}

async function need(s: pb.Server, id: string): Promise<pb.Remote> {
  return (await pb.read(s, pathOf(id))) ?? die(`no note ${pathOf(id)}`);
}

/** Write `next(current text)` until it lands on a rev nobody moved meanwhile. */
async function change(s: pb.Server, id: string, next: (text: string) => string): Promise<pb.Remote> {
  for (let tries = 0; tries < 3; tries++) {
    const cur = await need(s, id);
    try { return (await pb.update(s, cur, next(cur.text))) ?? die(`${cur.path} was deleted meanwhile`); } catch (e) {
      if (!(e instanceof pb.Conflict)) throw e;
    }
  }
  return die("the note keeps changing under this edit; try again");
}

/** `fn` over `items`, a few at a time: every note is a request, and a notebook is some hundreds. */
async function inBatches<T, R>(items: T[], fn: (x: T) => Promise<R>, size = 8): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

/** Every note and the attachments its body links, written under `dir`. An existing file there is overwritten. */
async function exportAll(s: pb.Server, dir: string) {
  const entries = (await pb.list(s)).filter((e) => isNotePath(e.path));
  const notes = (await inBatches(entries, (e) => pb.get(s, e.rec))).flatMap((n) => (n && isNotePath(n.path) ? [n] : []));   // one deleted meanwhile is skipped
  const plan = exportPlan(notes, await pb.photos(s));
  const put = (rel: string, data: string | Uint8Array) => { const file = join(dir, rel); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, data); };
  for (const e of plan) put(`notes/${fileNameOf(e.path)}`, e.text);
  const files = plan.flatMap((e) => e.files);
  await inBatches(files, async (f) => {
    const r = await fetch(pb.photoUrl(s, f.photo));
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
async function importAll(s: pb.Server, dir: string, dry: boolean, update: boolean) {
  if (!existsSync(dir)) die(`no folder ${dir}`);
  const t = await importNotes(s, { paths: walk(dir), text: async (f) => readFileSync(join(dir, f), "utf8"), blob: async (f) => Bun.file(join(dir, f)) },
    { dry, update, today: localDay(), onLine: (l) => console.log(`${l.what.padEnd(6)}  ${l.from} -> ${l.id}${l.what === "skip" ? " (taken)" : l.files ? ` (${l.files} files)` : ""}`) });
  console.error(dry ? `${t.found} notes found, ${t.taken} already there; nothing written (--dry-run)`
    : `${t.made} new, ${t.updated} updated, ${t.same} unchanged, ${t.skipped} skipped; ${t.files} attachments`);
}

const TASK_VIEWS = ["inbox", "today", "upcoming", "logbook"] as const;
type View = (typeof TASK_VIEWS)[number];

const taskLine = (t: Task, notes: string[] = []) => [t.id, t.title, t.evening && "this evening",
  t.when && `when ${t.when}`, t.due && `due ${t.due}`, t.every && `every ${t.every}`, t.remind && `remind ${t.remind}`,
  t.done && `done ${t.done}`, t.checklist.length && `${t.checklist.filter((i) => i.done).length}/${t.checklist.length} ticked`,
  t.tags.length && `tags ${t.tags.join(", ")}`, notes.length && `about ${notes.join(", ")}`].filter(Boolean).join(" · ");

/** Note record id -> its id as the commands take it (`20261005-lidl`). */
async function noteIds(s: pb.Server): Promise<Map<string, string>> {
  return new Map((await pb.list(s)).map((e) => [e.rec, idOf(e.path)]));
}

async function showTasks(s: pb.Server, view: View) {
  const v = views(await pb.tasks.list(s), localDay());
  const list = view === "today" ? [...v.today, ...v.evening] : view === "upcoming" ? v.upcoming.flatMap((d) => d.tasks) : v[view];
  const [links, notes] = list.length ? [await pb.links.list(s), await noteIds(s)] : [[], new Map<string, string>()];
  for (const t of list) console.log(taskLine(t, notesOfTask(links, t.id).flatMap((n) => notes.get(n) ?? [])));
}

/** What is linked to or from a note: tasks about it first, then the rest. */
async function showLinks(s: pb.Server, id: string) {
  const rec = (await need(s, id)).rec, end: LinkEnd = { type: "note", id: rec };
  const [all, notes, tasks] = [await pb.links.of(s, end), await noteIds(s), await pb.tasks.list(s)], title = new Map(tasks.map((t) => [t.id, t.title]));
  const name = (e: LinkEnd) => (e.type === "note" ? notes.get(e.id) : e.type === "task" ? [e.id, title.get(e.id)].filter(Boolean).join(" · ") : e.id) ?? e.id;
  const line = (arrow: string, l: Link, e: LinkEnd) => [`${arrow} ${e.type} ${name(e)}`, l.role].join(" · ");
  for (const l of backlinks(all, rec).sort((a, b) => +(b.from.type === "task") - +(a.from.type === "task"))) console.log(line("←", l, l.from));
  for (const l of linksFrom(all, end)) console.log(line("→", l, l.to));
}

/** Tasks about notes: `ids` are note ids; each is made (link) or dropped (unlink). Idempotent both ways. */
async function linkNotes(s: pb.Server, ref: string, ids: string[], drop: boolean) {
  const task = await taskBy(s, ref), end: LinkEnd = { type: "task", id: task.id };
  const recs = await Promise.all(ids.map(async (id) => (await need(s, id)).rec)), had = await pb.links.from(s, end);
  for (const rec of recs) {
    const to: LinkEnd = { type: "note", id: rec };
    if (!drop) { await pb.links.add(s, newLink(pb.recordId(), end, to, "about")); continue; }
    for (const l of had.filter((x) => x.role === "about" && x.to.type === "note" && x.to.id === rec)) await pb.links.remove(s, l.id);
  }
  console.error(`${drop ? "unlinked" : "linked"} ${recs.length} note${recs.length === 1 ? "" : "s"}`);
}

/** A task by id, or by the start of one that no other shares. */
async function taskBy(s: pb.Server, ref: string): Promise<Task> {
  const all = await pb.tasks.list(s), hits = all.filter((t) => t.id === ref);
  const found = hits.length ? hits : all.filter((t) => t.id.startsWith(ref));
  return found.length === 1 ? found[0] : die(found.length ? `${ref} starts several tasks: use more of the id` : `no task ${ref} (ids: tefnotes tasks)`);
}

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

const day = (v: string) => (v === "today" ? localDay() : v === "tomorrow" ? localDay(Date.now() + 86_400_000) : v);

async function edit(s: pb.Server, id: string) {
  const was = await need(s, id), file = join(tmpdir(), `tefnotes-${idOf(was.path).replace(/\//g, "_")}.md`);
  writeFileSync(file, was.text);
  const ed = Bun.spawnSync([...(process.env.VISUAL || process.env.EDITOR || "vi").split(" "), file], { stdio: ["inherit", "inherit", "inherit"] });
  if (ed.exitCode !== 0) die(`editor exited ${ed.exitCode}; nothing saved, your text is in ${file}`);
  const mine = readFileSync(file, "utf8");
  if (mine === was.text) return console.error("unchanged");
  try {
    const r = (await pb.update(s, was, mine)) ?? die(`${was.path} was deleted meanwhile; your text is in ${file}`);
    return console.error(`saved, rev ${r.rev}`);
  } catch (e) {
    if (!(e instanceof pb.Conflict)) throw e;
  }
  const theirs = await need(s, id), merged = reconcile(was.text, mine, theirs.text);
  if (merged == null) die(`changed on another device meanwhile, and the edits overlap; yours is in ${file}`);
  const r = (await pb.update(s, theirs, merged!)) ?? die(`${was.path} was deleted meanwhile; your text is in ${file}`);
  console.error(`merged with an edit made meanwhile, saved, rev ${r.rev}`);
}

async function main(argv: string[]) {
  const [cmd, ...a] = argv;
  if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") return console.log(HELP);
  if (cmd === "server") {
    const s = { url: pb.serverUrl(a[0] ?? die("tefnotes server <url>")) };
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
        console.log([idOf(c.path), c.title, c.tags.length ? `[${c.tags.join(", ")}]` : "", c.pinned && "pinned"].filter(Boolean).join(" · "));
      }
      return;
    }
    case "tags": {
      const { opt } = options(a, ["describe", "write"]);
      if (opt.has("write") && !opt.has("describe")) die("--write goes with --describe");
      const defs = await listTags(s);
      if (!opt.has("describe")) {
        for (const t of defs) console.log([t.name, t.color ?? "", t.description].filter(Boolean).join(" · "));
        return;
      }
      let described;
      try { described = await describeAllTags(s); } catch (e) { return die(describeError(e)); }
      for (const { tag, description } of described) {
        const def = defs.find((d) => d.name === tag);
        if (opt.has("write") && def) await updateTag(s, def.rec, { name: def.name, color: def.color, description });
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
      for (const r of await pb.search(s, a.join(" "))) console.log(`${idOf(r.path)} · ${parseNote(r.path, r.text).title}`);
      return;
    }
    case "new": {
      const title = a.join(" ").trim() || die("tefnotes new <title> [< body]");
      const body = (await stdin()).trimEnd(), taken = new Set((await pb.list(s)).map((e) => e.path));
      for (;;) {
        const path = newNotePath(title, Date.now(), taken);
        try {
          await pb.create(s, path, serializeNote({ title, created: localDay() }, body ? `${body}\n` : ""));
          return console.log(idOf(path));
        } catch (e) {
          if (!(e instanceof pb.Conflict)) throw e;
          taken.add(path);                                                    // made on the phone this very moment
        }
      }
    }
    case "append": {
      const id = a[0] ?? die("tefnotes append <id> [< text]"), text = (await stdin()).trim() || die("nothing on stdin to append");
      const r = await change(s, id, (t) => { const n = parseNote(pathOf(id), t); return t.slice(0, t.length - n.body.length) + appendToNote(n.body, text); });
      return console.error(`appended, rev ${r.rev}`);
    }
    case "put": {
      const [id, rev] = a;
      if (!id || !rev || !/^\d+$/.test(rev)) die("tefnotes put <id> <rev> [< file]   (rev: from tefnotes cat)");
      const text = await stdin(), cur = await need(s, id);
      try {
        const r = (await pb.update(s, { ...cur, rev: Number(rev) }, text)) ?? die(`${cur.path} was deleted meanwhile`);
        return console.error(`saved, rev ${r.rev}`);
      } catch (e) {
        if (e instanceof pb.Conflict) die(`${cur.path} is at rev ${cur.rev} now, not ${rev}: cat it again and redo the change`);
        throw e;
      }
    }
    case "edit": return edit(s, a[0] ?? die("tefnotes edit <id>"));
    case "rm": {
      const [id, rev] = a;
      if (!id || !rev || !/^\d+$/.test(rev)) die("tefnotes rm <id> <rev>   (rev: from tefnotes cat)");
      const cur = await need(s, id);
      try { await pb.remove(s, { rec: cur.rec, rev: Number(rev) }); } catch (e) {
        if (e instanceof pb.Conflict) die(`${cur.path} is at rev ${cur.rev} now, not ${rev}: it changed since you read it`);
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
      const { words, opt, all } = options(a, ["evening"]), title = words.join(" ").trim() || die("tefnotes add <title> [--when <day> --due <day> --every … --remind HH:MM --evening --note <id>…]");
      const fields: TaskPatch & { title: string } = {
        title, ...(opt.has("when") && { when: day(opt.get("when")!) }), ...(opt.has("due") && { due: day(opt.get("due")!) }),
        ...(opt.has("every") && { every: opt.get("every")! }), ...(opt.has("remind") && { remind: opt.get("remind")! }),
        ...(opt.has("evening") && { evening: true }),
      };
      const notes = await Promise.all([...new Set(all.get("note") ?? [])].map(async (id) => (await need(s, id)).rec));   // every note must exist before the task is made
      if (fields.evening && !fields.when) die("--evening needs --when");
      fields.order = nextOrder(await pb.tasks.list(s));
      for (let tries = 0; tries < 3; tries++) {
        let id: string;
        try { id = (await pb.tasks.create(s, newTask(pb.recordId(), fields))).id; } catch (e) {
          if (!(e instanceof pb.Conflict)) throw e;
          continue;
        }
        for (const rec of notes) await pb.links.add(s, newLink(pb.recordId(), { type: "task", id }, { type: "note", id: rec }, "about"));
        return console.log(id);
      }
      return die("couldn't name the task; try again");
    }
    case "done": {
      const ref = a[0] ?? die("tefnotes done <task-id>   (ids from tefnotes tasks)");
      for (let tries = 0; tries < 3; tries++) {
        const cur = await pb.tasks.get(s, (await taskBy(s, ref)).id);
        if (!cur) return die(`task ${ref} was deleted meanwhile`);
        const { rev, ...was } = cur, { task, next } = complete(was, localDay(), pb.recordId);
        if (task === was) return console.error("already done");
        try {
          const r = (await pb.tasks.update(s, cur.id, rev, task)) ?? die(`task ${ref} was deleted meanwhile`);
          if (next) {
            const made = await pb.tasks.create(s, next);
            for (const l of linksForNextRound(await pb.links.from(s, { type: "task", id: cur.id }), cur.id, made.id, pb.recordId)) await pb.links.add(s, l);
            console.error(`next round ${made.id}`);
          }
          return console.error(`done, rev ${r.rev}`);
        } catch (e) {
          if (!(e instanceof pb.Conflict)) throw e;
        }
      }
      return die("the task keeps changing under this edit; try again");
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
