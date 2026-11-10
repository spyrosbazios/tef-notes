/// <reference path="../pb_data/types.d.ts" />
// The browser extension's "save this page" (or this picture on it), filed the way the phone's agent files a share, in
// two steps so the owner approves where it goes before anything is written. What they decide and write: lib/clip.js.
//
//   POST /api/tefnotes/clip/suggest  JSON { url?, title, selection?, text? (the page's innerText), note? (the owner's
//        words), image? { src, alt?, caption?, look? (base64 JPEG, what JEV sees) } }; no url only with a selection or an image
//     200 { suggestions: [{ kind: "note", path, title, p } | { kind: "task", id, title, p }] (best first, at most 4),
//        pick: { kind: "new" } | { kind: "note", path } | { kind: "task", id }, line?: string }
//     Asks JEV, writes nothing. `line` is the page's own passage JEV picked as what the page is: the save sends it back.
//   POST /api/tefnotes/clip  multipart: `@jsonPayload` { url?, title, selection?, line?, note?, image? { src, alt?, caption? },
//        target: { kind: "new", title? } | { kind: "note", path } | { kind: "task", id } | { kind: "newtask", title? },
//        summary?: true, text? (the page's innerText, read only with summary), tags?: [name] (the owner's: a new note or
//        task carries them, an append adds those missing) } and, for a picture clipped to a note, a new note or a new task,
//        its JPEG as the `file` part (an existing task takes none: it holds no attachment)
//     200 { kind: "note", path, title, action: "created" | "appended", summary? } | { kind: "task", id, title,
//        action: "created" | "appended", note?, summary? }; `summary` ("added" | "skipped" | "failed") only when one was
//        asked for. A new task (`created`) gets the clip's text as its `notes`; with a picture, `note` is the path of a new
//        note holding the whole clip, picture first, which the task links to (`links`, role `about`): a task holds no
//        attachment. No JEV: target is the owner's choice. 404 if it is no longer there, 413 if a task's notes would overflow.
//   POST /api/tefnotes/clip/tags  JSON as suggest (the picture is not used)
//     200 { tags: [{ name, p }] (every defined tag, best first), picked: [name] (preselected: lib/clip.js tagPick) }
//     Asks JEV one yes/no per tag definition (lib/autotag.js), writes nothing; no key or no definitions: every tag, none
//     picked. Its own route so the tags arrive as soon as they are known, beside the suggestions.
//   GET  /api/tefnotes/clip/image?url=  the picture at a public URL, for the extension when it can't fetch it itself;
//     through lib/link-preview.js's guard, never $http.send. 400 for a URL refused, 502 when it is no picture.
//
// Errors are 4xx/5xx { error }. CORS is PocketBase's own (any origin, the chrome-extension:// one included); nothing is
// signed in, the tailnet is the gate (pb_migrations/1792400000_open.js).
//
// JEV answers in a few seconds. Without a key, or when it fails, suggest still answers: no suggestions, pick "new", so
// the owner can still save it as a note of its own. A picture it refuses (TypeSafe's images are opt-in and early) is
// asked about again by its words alone. The owner's note is written up by the server's model (lib/llm.js); without its key,
// or when it fails, the note goes in as typed. When the owner ticked "Add a summary", the model also writes one (lib/clip.js,
// summary): from the page's text, which for a link that came with none is fetched through lib/link-preview.js's guard; the
// clip is saved with or without it. The log says why, never a key.
//
// Writes bypass the request hooks (rev.pb.js), so the rev contract is kept here: an append re-reads the note (or the
// task, whose `notes` it adds to) inside the transaction that writes it, so it is based on the rev it replaces, and bumps
// it; a new note or task starts at rev 1 (a new task after every other in `order`).
// Every column a client copies out of the frontmatter is written beside `text` (lib/notes.js columns). A picture is an
// `attachments` record under the note's id, saved first and deleted again if the note's write fails: never one without
// the other.
// A handler runs in its own VM and sees nothing of this file's top level: each requires what it uses.

routerAdd("POST", "/api/tefnotes/clip/suggest", (e) => {
  const lib = require(`${__hooks}/lib/clip.js`), notes = require(`${__hooks}/lib/notes.js`), jev = require(`${__hooks}/lib/jev.js`), keys = require(`${__hooks}/lib/keys.js`);
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
    try { memory = e.app.findFirstRecordByFilter("notes", "path = {:p}", { p: notes.MEMORY }).getString("text").trim(); } catch (_) { /* none yet */ }
    const ps = lib.passages(clip.text);

    let out = lib.suggest(null, index, tasks, ps);
    const key = keys.read("typesafe");   // none: no suggestions
    if (!key) log("no TypeSafe key: no suggestions");
    else {
      try {
        const ask = (ref) => $http.send(jev.request(key, lib.request(clip, index, tasks, memory, ps, now, ref)));
        let res = ask(clip.image && clip.image.look ? `picture-${$security.randomString(24)}` : null);
        if ((res.statusCode === 400 || res.statusCode === 413) && clip.image && clip.image.look) {
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
});

routerAdd("POST", "/api/tefnotes/clip/tags", (e) => {
  const lib = require(`${__hooks}/lib/clip.js`), auto = require(`${__hooks}/lib/autotag.js`), jev = require(`${__hooks}/lib/jev.js`), keys = require(`${__hooks}/lib/keys.js`);
  const log = (msg, ...kv) => e.app.logger().warn(`clip: ${msg}`, ...kv);

  let clip;
  try { clip = lib.input(e.requestInfo().body); } catch (err) {
    if (err instanceof lib.Bad) return e.json(400, { error: err.message });
    throw err;
  }
  const defs = e.app.findAllRecords("tags").map((r) => ({ name: r.getString("name").trim(), description: r.getString("description") })).filter((d) => d.name);
  const scored = (ps) => {
    const seen = new Set(ps.map((x) => x.name));
    return e.json(200, lib.tagPick([...ps, ...defs.filter((d) => !seen.has(d.name)).map((d) => ({ name: d.name, p: 0 }))], auto.AUTO));
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
});

routerAdd("POST", "/api/tefnotes/clip", (e) => {
  const lib = require(`${__hooks}/lib/clip.js`), notes = require(`${__hooks}/lib/notes.js`), ds = require(`${__hooks}/lib/llm.js`).llm(), keys = require(`${__hooks}/lib/keys.js`);
  const { without } = require(`${__hooks}/lib/autotag.js`);
  const log = (msg, ...kv) => e.app.logger().warn(`clip: ${msg}`, ...kv);

  let clip, files = [];
  try { clip = lib.saveInput(e.requestInfo().body); } catch (err) {
    if (err instanceof lib.Bad) return e.json(400, { error: err.message });
    throw err;
  }
  try { files = e.findUploadedFiles("file"); } catch (_) { /* a page: no file part */ }
  // A picture's JPEG is the `file` part, kept as an attachment of the note it goes in (for a new task, a new note the task
  // links to); a page's clip, and any to an existing task, send none.
  const kept = !!clip.image && clip.target.kind !== "task";
  if (kept !== files.length > 0 || files.length > 1) {
    return e.json(400, { error: "A picture's clip to a note, a new note or a new task sends its JPEG as the `file` part; a page's, or any clip to an existing task, sends none." });
  }

  // The owner's note, written up: as typed without a key, or when the model fails.
  let note = clip.note;
  if (note) {
    const key = ds.credential(keys.read);
    if (!key) log(`no ${ds.label} key: the note goes in as typed`);
    else {
      try {
        const q = lib.noteRequest(clip, clip.line), res = $http.send(ds.request(key, q.system, q.user));
        if (res.statusCode === 200) note = lib.noteOf(ds.text(res.json), clip.note);
        else log(`${ds.label} refused: the note goes in as typed`, "status", res.statusCode);
      } catch (err) {
        log(`${ds.label} failed: the note goes in as typed`, "error", String(err).slice(0, 200));
      }
    }
  }

  // The summary, when the owner asked for one: "added", "skipped" (nothing to summarise it from) or "failed" (no key, the
  // page could not be read, or the model failed); the clip is saved either way, and the answer says which. lib/clip.js summarise.
  let summary = "", outcome;
  if (clip.summary) {
    const lp = require(`${__hooks}/lib/link-preview.js`), run = (name, ...args) => toString($os.exec(name, ...args).output());
    const key = ds.credential(keys.read);
    const r = lib.summarise(clip, {
      key,
      page: (url) => lp.textOf(url, { lookup: lp.getent(run), get: lp.curl(run) }),
      blocked: (err) => err instanceof lp.Blocked,
      ask: (system, user) => { const res = $http.send(ds.request(key, system, user, 30)); return { status: res.statusCode, text: res.statusCode === 200 ? ds.text(res.json) : "" }; },
      log,
    });
    summary = r.block; outcome = r.outcome;
  }

  const now = Date.now();
  let att = null;
  /** The picture saved under `noteId`, and its image line for the body; "" for a page. */
  const attach = (noteId) => {
    if (!files.length) return "";
    const taken = arrayOf(new DynamicModel({ name: "" }));
    e.app.db().newQuery("SELECT name FROM attachments WHERE note = {:id}").bind({ id: noteId }).all(taken);
    const name = notes.photoName(now, new Set(taken.map((r) => r.name)));
    att = new Record(e.app.findCollectionByNameOrId("attachments"));
    att.set("note", noteId);
    att.set("name", name);
    att.set("file", files[0]);
    e.app.save(att);
    return lib.embedOf(clip.image, noteId, name);
  };
  /** A new note of the whole clip (the picture first, when there is one), titled `title`, at rev 1: its record, unsaved. */
  const newNote = (title) => {
    const stem = notes.pathStem(title, now), taken = arrayOf(new DynamicModel({ path: "" }));
    e.app.db().newQuery("SELECT path FROM notes WHERE path LIKE {:stem}").bind({ stem: `${stem}%` }).all(taken);
    const path = notes.newNotePath(title, now, new Set(taken.map((r) => r.path)));
    const body = lib.bodyOf(clip, clip.line, note, attach(notes.idOf(path)), summary);
    const text = notes.serialize({ title, created: notes.localDay(now), tags: without(clip.tags, []) }, body);
    const rec = new Record(e.app.findCollectionByNameOrId("notes")), cols = notes.columns(path, text);
    for (const k of Object.keys(cols)) rec.set(k, cols[k]);
    rec.set("rev", 1);
    return { path, rec };
  };
  const unattach = () => {
    if (!att) return;
    try { e.app.delete(att); } catch (err) { log("could not remove the picture of a failed save", "note", att.getString("note"), "error", String(err).slice(0, 200)); }
  };

  try {
    let out = null;
    if (clip.target.kind === "task") {
      const id = clip.target.id, gone = () => e.json(404, { error: "That task no longer exists." });
      try { e.app.findRecordById("tasks", id); } catch (_) { return gone(); }
      const body = lib.bodyOf(clip, clip.line, note, clip.image ? lib.pictureLine(clip.image) : "", summary);
      let full = false;
      e.app.runInTransaction((tx) => {
        let rec;
        try { rec = tx.findRecordById("tasks", id); } catch (_) { return; }
        const next = lib.taskNotes(rec.getString("notes"), body);
        if (next == null) { full = true; return; }
        rec.set("notes", next);
        let had = [];
        try { const v = JSON.parse(rec.getString("tags") || "[]"); if (Array.isArray(v)) had = v.filter((t) => typeof t === "string"); } catch (_) { /* none */ }
        rec.set("tags", [...had, ...without(clip.tags, had)]);
        rec.set("rev", rec.getInt("rev") + 1);
        tx.save(rec);
        out = { kind: "task", id, title: rec.getString("title"), action: "appended" };
      });
      if (full) return e.json(413, { error: "That task's notes are full." });
      if (!out) return gone();
    } else if (clip.target.kind === "note") {
      const target = clip.target.path;
      try { e.app.findFirstRecordByFilter("notes", "path = {:p}", { p: target }); } catch (_) { return e.json(404, { error: "That note no longer exists." }); }
      const body = lib.bodyOf(clip, clip.line, note, attach(notes.idOf(target)), summary);
      e.app.runInTransaction((tx) => {
        let rec;
        try { rec = tx.findFirstRecordByFilter("notes", "path = {:p}", { p: target }); } catch (_) { return; }
        const text = rec.getString("text"), n = notes.parse(target, text);
        const added = without(clip.tags, n.tags);
        let next = notes.withBody(text, n, notes.appended(n.body, body));
        if (added.length) next = notes.withTags(target, next, [...n.tags, ...added]);
        const cols = notes.columns(target, next);
        for (const k of Object.keys(cols)) rec.set(k, cols[k]);
        rec.set("rev", rec.getInt("rev") + 1);
        tx.save(rec);
        out = { kind: "note", path: target, title: n.title, action: "appended" };
      });
      if (!out) { unattach(); return e.json(404, { error: "That note no longer exists." }); }
    } else if (clip.target.kind === "newtask") {
      // The text without the picture as the task's notes; the picture, when there is one, in a new note of the whole clip
      // the task is `about` (lib/links.js). Note, task and link in one transaction: all or none.
      const title = lib.titleOf(clip, clip.line, now);
      const text = lib.taskNotes("", lib.bodyOf(clip, clip.line, note, "", summary));
      if (text == null) return e.json(413, { error: "The clip is too long for a task's notes." });
      const made = files.length ? newNote(title) : null;
      e.app.runInTransaction((tx) => {
        if (made) tx.save(made.rec);
        const next = new DynamicModel({ n: 0 });
        tx.db().newQuery('SELECT IFNULL(MAX("order"), -1) + 1 AS n FROM tasks').one(next);
        const task = new Record(tx.findCollectionByNameOrId("tasks"));
        task.set("title", title);
        task.set("notes", text);
        task.set("checklist", []);
        task.set("tags", without(clip.tags, []));
        task.set("order", next.n);
        task.set("rev", 1);
        tx.save(task);
        if (made) {
          const link = new Record(tx.findCollectionByNameOrId("links"));
          link.set("fromTask", task.id);
          link.set("toNote", made.rec.id);
          link.set("role", "about");
          tx.save(link);
        }
        out = made ? { kind: "task", id: task.id, title, action: "created", note: made.path } : { kind: "task", id: task.id, title, action: "created" };
      });
    } else {
      const title = lib.titleOf(clip, clip.line, now), made = newNote(title);
      e.app.save(made.rec);
      out = { kind: "note", path: made.path, title, action: "created" };
    }
    return e.json(200, outcome ? { ...out, summary: outcome } : out);
  } catch (err) {
    unattach();
    log("failed", "url", clip.url, "error", String(err).slice(0, 300));
    return e.json(500, { error: "The clip could not be saved." });
  }
});

routerAdd("GET", "/api/tefnotes/clip/image", (e) => {
  const lp = require(`${__hooks}/lib/link-preview.js`);
  const fail = (status, error) => e.json(status, { error });

  let url;
  try { url = lp.parseUrl(e.request.url.query().get("url") || "").href; } catch (err) {
    if (err instanceof lp.Blocked) return fail(400, `The server won't fetch that picture: ${err.message}.`);
    throw err;
  }
  const file = `${$os.tempDir()}/tefnotes-clip-${$security.randomString(20)}`;
  try {
    const run = (name, ...args) => toString($os.exec(name, ...args).output());
    let page;
    try { page = lp.fetchPage(url, { lookup: lp.getent(run), get: lp.curlFile(run, file) }); } catch (err) {
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
});
