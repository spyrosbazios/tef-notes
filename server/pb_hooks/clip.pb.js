/// <reference path="../pb_data/types.d.ts" />
// The browser extension's "save this page" (or this picture on it), and the phone's share sheet (the web app's share page
// and the Android companion: text, a link, pictures, PDFs), filed the way the phone's agent files a share, in two steps so the owner approves where it goes before anything is written. What they decide and write: lib/clip.js.
//
//   POST /api/tefnotes/clip/suggest  JSON { url?, title, selection?, text? (the page's innerText), note? (the owner's
//        words), images?: [{ src, alt?, caption?, look? (base64 JPEG, what JEV sees: the first picture's) }], pdfs?: [{ name }] };
//        no url only with a selection, a picture or a PDF; at most lib/clip.js FILES pictures and PDFs
//     200 { suggestions: [{ kind: "note", path, title, p } | { kind: "task", id, title, p }] (best first, at most 4),
//        pick: { kind: "new" } | { kind: "note", path } | { kind: "task", id }, line?: string }
//     Asks JEV, writes nothing. `line` is the page's own passage JEV picked as what the page is: the save sends it back.
//   POST /api/tefnotes/clip  multipart: `@jsonPayload` { url?, title, selection?, line?, note?, images?: [{ src, alt?, caption? }], pdfs?: [{ name }],
//        target: { kind: "new", title? } | { kind: "note", path } | { kind: "task", id } | { kind: "newtask", title? },
//        summary?: true, text? (the page's innerText, read only with summary), tags?: [name] (the owner's picks: a new note or
//        task carries them and the lens's tag, added here, an append adds the picks missing) } and, for a clip to a note, a new note or a new task, one `file`
//        part per file in the payload's order: each picture's JPEG, then each PDF as it is (an existing task takes none: it
//        holds no attachment). The body may be up to 260 MB (PocketBase's default is 32 MB: a couple of PDFs pass it).
//     200 { kind: "note", path, title, action: "created" | "appended", summary? } | { kind: "task", id, title,
//        action: "created" | "appended", note?, summary? }; `summary` ("added" | "skipped" | "failed") only when one was
//        asked for. A new task (`created`) gets the clip's text as its `notes`; with files, `note` is the path of a new
//        note holding the whole clip, files first, which the task links to (`links`, role `about`): a task holds no
//        attachment. No JEV: target is the owner's choice. 404 if it is no longer there, 413 if a task's notes would overflow.
//   POST /api/tefnotes/clip/tags  JSON as suggest (the picture is not used)
//     200 { tags: [{ name, p }] (every defined or used tag, best first; undefined ones scored 0), picked: [name] (preselected as the auto-tagger would add them: lib/autotag.js decide) }
//     Asks JEV one yes/no per tag definition (lib/autotag.js), writes nothing; no key or no definitions: every tag, none
//     picked. Its own route so the tags arrive as soon as they are known, beside the suggestions.
//   GET  /api/tefnotes/clip/image?url=  the picture at a public URL, for the extension when it can't fetch it itself;
//     through lib/link-preview.js's guard, never $http.send. 400 for a URL refused, 502 when it is no picture.
//
// Errors are 4xx/5xx { error }. Nothing is signed in, the tailnet is the gate (pb_migrations/1792400000_open.js); a
// browser request from another site is refused before it gets here (origin.pb.js), the extension's taken.
//
// JEV answers in a few seconds. Without a key, or when it fails, suggest still answers: no suggestions, pick "new", so
// the owner can still save it as a note of its own. A picture it refuses (TypeSafe's images are opt-in and early) is
// asked about again by its words alone. The owner's note is written up by the server's model (lib/llm.js); without its key,
// or when it fails, the note goes in as typed. When the owner ticked "Add a summary", the model also writes one (lib/clip.js,
// summary): from the page's text, which for a link that came with none is fetched through lib/link-preview.js's guard; the
// clip is saved with or without it. The log says why, never a key.
//
// Writes bypass the request hooks (rev.pb.js), so the rev contract is lib/records.js's: an append re-reads the note (or
// the task, whose `notes` it adds to) inside the transaction that writes it, bumps its rev and copies a note's columns
// out of its text; a new note or task starts at rev 1 (a new task after every other in `order`). Every write is marked
// `tainted` (tainted.pb.js): a clip is someone else's text, and the owner's note is the model's write-up. Each file is an
// `attachments` record under the note's id (its collection checks the type and size), saved first and deleted again if
// the note's write fails: never one without the other.
// A handler runs in its own VM and sees nothing of this file's top level: each requires what it uses.

routerAdd("POST", "/api/tefnotes/clip/suggest", (e) => require(`${__hooks}/lib/http.js`).route(e, "clip", "No suggestions could be made.", () => {
  const lib = require(`${__hooks}/lib/clip.js`), core = require(`${__hooks}/lib/core.js`), jev = require(`${__hooks}/lib/jev.js`), keys = require(`${__hooks}/lib/keys.js`);
  const log = (msg, ...kv) => e.app.logger().warn(`clip: ${msg}`, ...kv);

  let clip;
  try { clip = lib.input(e.requestInfo().body); } catch (err) {
    if (err instanceof lib.Bad) return e.json(400, { error: err.message });
    throw err;
  }

  try {
    const now = Date.now();
    const rows = arrayOf(new DynamicModel({ path: "", title: "", tags: "", pinned: 0, updated: "" }));
    e.app.db().newQuery("SELECT path, title, CAST(IFNULL(tags, '[]') AS TEXT) AS tags, pinned + 0 AS pinned, updated FROM notes WHERE path LIKE 'notes/%' AND NOT IFNULL(archived, 0)").all(rows);   // never filed into an archived note
    const index = lib.noteIndex(rows.map((r) => lib.row({ path: r.path, title: r.title, tags: r.tags, pinned: r.pinned, updated: r.updated })));
    const open = arrayOf(new DynamicModel({ id: "", title: "", scheduled: "", due: "", updated: "" }));
    e.app.db().newQuery("SELECT t.id AS id, t.title AS title, IFNULL(t.`when`, '') AS scheduled, IFNULL(t.due, '') AS due, t.updated AS updated FROM tasks t WHERE IFNULL(t.done, '') = '' ORDER BY t.updated DESC LIMIT {:n}").bind({ n: lib.TASKS }).all(open);
    const tasks = lib.taskIndex(open.map((r) => lib.taskRow(r)));
    let memory = "";
    try { memory = e.app.findFirstRecordByFilter("notes", "path = {:p}", { p: core.MEMORY }).getString("text").trim(); } catch (_) { /* none yet */ }
    const ps = lib.passages(clip.text);

    let out = lib.suggest(null, index, tasks, ps);
    const key = keys.read("typesafe");   // none: no suggestions
    if (!key) log("no TypeSafe key: no suggestions");
    else {
      try {
        const ask = (ref) => $http.send(jev.request(key, lib.request(clip, index, tasks, memory, ps, now, ref)));
        const look = clip.images.length > 0 && !!clip.images[0].look;
        let res = ask(look ? `picture-${$security.randomString(24)}` : null);
        if ((res.statusCode === 400 || res.statusCode === 413) && look) {
          log("TypeSafe refused the picture: asking by its words", "status", res.statusCode);
          res = ask(null);
        }
        if (res.statusCode === 200) out = lib.suggest(res.json, index, tasks, ps);
        else log("TypeSafe refused: no suggestions", "status", res.statusCode);
      } catch (err) {
        log("request failed: no suggestions", "error", String(err).slice(0, 200));
      }
    }
    return e.json(200, out.line ? out : { suggestions: out.suggestions, pick: out.pick });
  } catch (err) {
    log("suggest failed", "url", clip.url, "error", String(err).slice(0, 300));
    return e.json(500, { error: "No suggestions could be made." });
  }
}));

routerAdd("POST", "/api/tefnotes/clip/tags", (e) => require(`${__hooks}/lib/http.js`).route(e, "clip", "The tags could not be scored.", () => {
  const lib = require(`${__hooks}/lib/clip.js`), auto = require(`${__hooks}/lib/autotag.js`), jev = require(`${__hooks}/lib/jev.js`), keys = require(`${__hooks}/lib/keys.js`);
  const log = (msg, ...kv) => e.app.logger().warn(`clip: ${msg}`, ...kv);

  let clip;
  try { clip = lib.input(e.requestInfo().body); } catch (err) {
    if (err instanceof lib.Bad) return e.json(400, { error: err.message });
    throw err;
  }
  const defs = auto.load(e.app);
  // Every tag the owner could add by hand: the defined ones (JEV scores those) and any a note or task carries undefined.
  const used = arrayOf(new DynamicModel({ name: "" }));
  e.app.db().newQuery("SELECT DISTINCT TRIM(j.value) AS name FROM notes, json_each(IFNULL(notes.tags, '[]')) j WHERE j.type = 'text' UNION SELECT DISTINCT TRIM(j.value) FROM tasks, json_each(IFNULL(tasks.tags, '[]')) j WHERE j.type = 'text'").all(used);
  const names = [...new Set([...defs.map((d) => d.name), ...used.map((u) => u.name).filter(Boolean)])];
  const scored = (ps) => {
    const seen = new Set(ps.map((x) => x.name));
    return e.json(200, lib.tagPick([...ps, ...names.filter((n) => !seen.has(n)).map((name) => ({ name, p: 0 }))], auto.decide(ps, defs)));
  };
  const key = keys.read("typesafe");
  if (!key || !defs.length) return scored([]);
  const item = { kind: "page", title: clip.title, body: [clip.url, clip.note, clip.selection, clip.text].filter(Boolean).join("\n\n") };
  try {
    const ps = [];
    for (const r of auto.requests(item, defs)) {
      const res = $http.send(jev.request(key, r.body));
      if (res.statusCode !== 200) { log("TypeSafe refused the tags", "status", res.statusCode); return scored([]); }
      ps.push(...auto.probabilities(r.defs, res.json));
    }
    return scored(ps);
  } catch (err) {
    log("tags failed", "error", String(err).slice(0, 200));
    return scored([]);
  }
}));

routerAdd("POST", "/api/tefnotes/clip", (e) => require(`${__hooks}/lib/http.js`).route(e, "clip", "The clip could not be saved.", () => {
  const lib = require(`${__hooks}/lib/clip.js`), core = require(`${__hooks}/lib/core.js`), ds = require(`${__hooks}/lib/llm.js`).llm(), keys = require(`${__hooks}/lib/keys.js`);
  const { without } = require(`${__hooks}/lib/autotag.js`), { env } = require(`${__hooks}/lib/env.js`), records = require(`${__hooks}/lib/records.js`), rows = require(`${__hooks}/lib/rows.js`);
  const log = (msg, ...kv) => e.app.logger().warn(`clip: ${msg}`, ...kv);

  let clip, files = [];
  try { clip = lib.saveInput(e.requestInfo().body); } catch (err) {
    if (err instanceof lib.Bad) return e.json(400, { error: err.message });
    throw err;
  }
  try { files = e.findUploadedFiles("file"); } catch (_) { /* a page: no file part */ }

  // Each file is a `file` part, kept as an attachment of the note it goes in (for a new task, a new note the task links
  // to); a clip to an existing task sends none. Checked before anything is fetched or asked.
  if (files.length !== lib.filesSent(clip)) {
    return e.json(400, { error: "A clip to a note, a new note or a new task sends a `file` part per picture and PDF, in that order; a clip to an existing task sends none." });
  }

  // A new note or task carries the lens's tag, whichever client sent it: the clients send the owner's picks alone
  let prefs = null;
  try { prefs = JSON.parse(e.app.findFirstRecordByData("prefs", "key", "owner").getString("data") || "null"); } catch (_) { /* none saved yet: no lens */ }
  clip.tags = lib.savedTags(clip, lib.lensTag(prefs, (id) => {
    try { return rows.names(e.app.findRecordById("lenses", id).getString("tags")); } catch (_) { return null; }
  }));

  // Every call to another service below (the page's title, the note's write-up, the summary, the agent's title) shares one
  // deadline, so the save answers well inside the clients' wait; one that would start too late is skipped, as if it failed.
  const until = Date.now() + lib.DEADLINE_MS, lp = require(`${__hooks}/lib/link-preview.js`);
  /** `$http.send(req)` with its timeout cut to what is left; throws when too little is left to try. */
  const send = (req) => {
    const timeout = lib.secondsLeft(until, req.timeout);
    if (!timeout) throw new Error("out of time: the clip's deadline passed");
    return $http.send({ ...req, timeout });
  };

  // A link without its page's title (the companion sends none; the web's preview may have failed): the page's own, from the
  // link-preview cache (keyed by the URL as lib/link-preview.js parseUrl writes it) or fetched through its guard. None
  // found: titled as before, by the text or the site.
  if (clip.url && !clip.title) {
    try {
      const r = e.app.findFirstRecordByFilter("link_previews", "url = {:url}", { url: lp.parseUrl(clip.url).href });
      clip.title = r.getString("title");
    } catch (_) { /* not cached, or a URL the server won't fetch */ }
    if (!clip.title) {
      try { clip.title = ((lp.previewOf(clip.url, lp.io({ deadline: until })) || {}).title || "").trim(); } catch (err) {
        log("no page title", "url", clip.url, "error", String(err).slice(0, 200));
      }
    }
  }

  // The owner's note, written up: as typed without a key, or when the model fails.
  let note = clip.note;
  if (note) {
    const key = ds.credential(keys.read);
    if (!key) log(`no ${ds.label} key: the note goes in as typed`);
    else {
      try {
        const q = lib.noteRequest(clip, clip.line), res = send(ds.request(key, q.system, q.user));
        if (res.statusCode === 200) note = lib.noteOf(ds.text(res.json), clip.note);
        else log(`${ds.label} refused: the note goes in as typed`, "status", res.statusCode);
      } catch (err) {
        log(`${ds.label} failed: the note goes in as typed`, "error", String(err).slice(0, 200));
      }
    }
  }

  // The summary, when the owner asked for one: "added", "skipped" (nothing to summarise it from) or "failed" (no key, the
  // page could not be read, the model failed, or no time was left); the clip is saved either way, and the answer says
  // which. lib/clip.js summarise.
  let summary = "", outcome;
  if (clip.summary) {
    const key = ds.credential(keys.read);
    const r = lib.summarise(clip, {
      key,
      page: (url) => lp.textOf(url, lp.io({ deadline: until })),
      blocked: (err) => err instanceof lp.Blocked,
      ask: (system, user) => { const res = send(ds.request(key, system, user, 30)); return { status: res.statusCode, text: res.statusCode === 200 ? ds.text(res.json) : "" }; },
      log,
    });
    summary = r.block; outcome = r.outcome;
  }

  const now = Date.now();
  const atts = [];
  /** The files saved under `noteId`, and their lines for the body; "" for none. */
  const attach = (noteId) => {
    if (!files.length) return "";
    const taken = arrayOf(new DynamicModel({ name: "" }));
    e.app.db().newQuery("SELECT name FROM attachments WHERE note = {:id}").bind({ id: noteId }).all(taken);
    const { names, embed } = lib.filesUnder(clip, noteId, new Set(taken.map((r) => r.name)), now);
    names.forEach((name, i) => {
      const att = new Record(e.app.findCollectionByNameOrId("attachments"));
      att.set("note", noteId);
      att.set("name", name);
      att.set("file", files[i]);
      e.app.save(att);
      atts.push(att);
    });
    return embed;
  };
  /** A new note of the whole clip (the files first, when there are any), titled `title`: its path and its text under the
   *  title it has then (`text()`), saved by `saveNote`. Its path stays the one the first title gave it. */
  const newNote = (title) => {
    const stem = core.newNotePath(title, now).replace(/\.md$/, ""), taken = arrayOf(new DynamicModel({ path: "" }));
    e.app.db().newQuery("SELECT path FROM notes WHERE path LIKE {:stem}").bind({ stem: `${stem}%` }).all(taken);
    const path = core.newNotePath(title, now, new Set(taken.map((r) => r.path)));
    const body = lib.bodyOf(clip, clip.line, note, attach(core.noteIdOf(path)), summary);
    const made = { path, title, text: () => core.serializeNote({ title: made.title, created: core.localDay(now), tags: without(clip.tags, []) }, body) };
    return made;
  };
  const saveNote = (tx, made) => records.create(tx, "notes", (r) => { r.set("path", made.path); r.set("text", made.text()); }, { taint: true });
  /** A clip of files alone: once they are stored under `made`, the agent's title for them (a PDF's first pages, a photo
   *  looked at), on the unsaved note too; else `title`, the clip's own. Titling never fails the save. */
  const AGENT = env("TEF_NOTES_AGENT") || "http://agent:8098";
  const retitle = (made, title) => {
    if (!made || !lib.filesOnly(clip)) return title;
    try {
      const res = send({
        url: `${AGENT}/agent/title`, method: "POST", timeout: 50,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: core.noteIdOf(made.path) }),
      });
      const t = res.statusCode === 200 ? lib.agentTitle(res.json) : "";
      if (res.statusCode !== 200) log("the agent could not title it", "status", res.statusCode);
      if (!t) return title;
      made.title = t;
      return t;
    } catch (err) {
      log("the agent could not title it", "error", String(err).slice(0, 200));
      return title;
    }
  };
  const unattach = () => {
    for (const att of atts) {
      try { e.app.delete(att); } catch (err) { log("could not remove a file of a failed save", "note", att.getString("note"), "error", String(err).slice(0, 200)); }
    }
  };

  try {
    let out = null;
    if (clip.target.kind === "task") {
      const id = clip.target.id, gone = () => e.json(404, { error: "That task no longer exists." });
      try { e.app.findRecordById("tasks", id); } catch (_) { return gone(); }
      const body = lib.bodyOf(clip, clip.line, note, lib.fileLines(clip), summary);
      let full = false;
      e.app.runInTransaction((tx) => {
        const rec = records.casWrite(tx, "tasks", id, (r) => {
          const next = lib.taskNotes(r.getString("notes"), body);
          if (next == null) { full = true; return false; }
          r.set("notes", next);
          const had = rows.names(r.getString("tags"));
          r.set("tags", [...had, ...without(clip.tags, had)]);
        }, { taint: true });
        if (rec) out = { kind: "task", id, title: rec.getString("title"), action: "appended" };
      });
      if (full) return e.json(413, { error: "That task's notes are full." });
      if (!out) return gone();
    } else if (clip.target.kind === "note") {
      const target = clip.target.path;
      let id;
      try { id = e.app.findFirstRecordByFilter("notes", "path = {:p}", { p: target }).id; } catch (_) { return e.json(404, { error: "That note no longer exists." }); }
      const body = lib.bodyOf(clip, clip.line, note, attach(core.noteIdOf(target)), summary);
      e.app.runInTransaction((tx) => {
        let title = "";
        const rec = records.casWrite(tx, "notes", id, (r) => {
          const text = r.getString("text"), n = core.parseNote(target, text);
          const added = without(clip.tags, n.tags);
          let next = core.withBody(text, n, core.appended(n.body, body));
          if (added.length) next = core.withFlags(target, next, { tags: [...n.tags, ...added] });
          r.set("text", next);
          title = n.title;
        }, { taint: true });
        if (rec) out = { kind: "note", path: target, title, action: "appended" };
      });
      if (!out) { unattach(); return e.json(404, { error: "That note no longer exists." }); }
    } else if (clip.target.kind === "newtask") {
      // The text without the files as the task's notes; the files, when there are any, in a new note of the whole clip
      // the task is `about` (lib/links.js). Note, task and link in one transaction: all or none.
      const text = lib.taskNotes("", lib.bodyOf(clip, clip.line, note, "", summary));
      if (text == null) return e.json(413, { error: "The clip is too long for a task's notes." });
      const first = lib.titleOf(clip, clip.line), made = files.length ? newNote(first) : null;
      const title = retitle(made, first);
      e.app.runInTransaction((tx) => {
        const saved = made ? saveNote(tx, made) : null;
        const next = new DynamicModel({ n: 0 });
        tx.db().newQuery('SELECT IFNULL(MAX("order"), -1) + 1 AS n FROM tasks').one(next);
        const task = records.create(tx, "tasks", (t) => {
          t.set("title", title);
          t.set("notes", text);
          t.set("checklist", []);
          t.set("tags", without(clip.tags, []));
          t.set("order", next.n);
        }, { taint: true });
        if (saved) {
          const link = new Record(tx.findCollectionByNameOrId("links"));
          link.set("fromTask", task.id);
          link.set("toNote", saved.id);
          link.set("role", "about");
          tx.save(link);
        }
        out = made ? { kind: "task", id: task.id, title, action: "created", note: made.path } : { kind: "task", id: task.id, title, action: "created" };
      });
    } else {
      const first = lib.titleOf(clip, clip.line), made = newNote(first), title = retitle(made, first);
      e.app.runInTransaction((tx) => { saveNote(tx, made); });
      out = { kind: "note", path: made.path, title, action: "created" };
    }
    return e.json(200, outcome ? { ...out, summary: outcome } : out);
  } catch (err) {
    unattach();
    log("failed", "url", clip.url, "error", String(err).slice(0, 300));
    return e.json(500, { error: "The clip could not be saved." });
  }
}), $apis.bodyLimit(260 * 1024 * 1024));   // FILES (10) PDFs of 25 MB each, and the JSON

routerAdd("GET", "/api/tefnotes/clip/image", (e) => require(`${__hooks}/lib/http.js`).route(e, "clip", "The picture could not be fetched.", () => {
  const lp = require(`${__hooks}/lib/link-preview.js`);
  const fail = (status, error) => e.json(status, { error });

  let url;
  try { url = lp.parseUrl(e.request.url.query().get("url") || "").href; } catch (err) {
    if (err instanceof lp.Blocked) return fail(400, `The server won't fetch that picture: ${err.message}.`);
    throw err;
  }
  const file = `${$os.tempDir()}/tefnotes-clip-${$security.randomString(20)}`;
  try {
    let page;
    try { page = lp.fetchPage(url, lp.io({ file })); } catch (err) {
      if (err instanceof lp.Blocked) return fail(400, `The server won't fetch that picture: ${err.message}.`);
      return fail(502, "The picture's site did not answer.");
    }
    const type = page.type.split(";")[0].trim();
    if (page.status >= 400 || !/^image\/[a-z0-9.+-]+$/.test(type)) return fail(502, "That address is no picture the server can fetch.");
    const bytes = $os.readFile(file);
    if (bytes.length >= lp.IMAGE_BYTES) return fail(413, "The picture is too big.");
    // Bytes from anywhere, on this origin: never rendered as a page here (an SVG could carry script).
    e.response.header().set("Content-Security-Policy", "sandbox; default-src 'none'");
    e.response.header().set("Content-Disposition", "attachment");
    e.response.header().set("X-Content-Type-Options", "nosniff");
    return e.blob(200, type, bytes);
  } finally {
    try { $os.remove(file); } catch (_) { /* never written */ }
  }
}));
