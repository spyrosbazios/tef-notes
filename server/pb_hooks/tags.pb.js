/// <reference path="../pb_data/types.d.ts" />
// Renaming a tag (below), and tag descriptions written from the notes that carry the tag, for the tag editors (phone, web, CLI): the logic is
// lib/tags.js, the server's model (lib/llm.js, its one writing model). The route writes nothing: the client shows the text
// and saves it with the tag the normal way (the `tags` collection's `description`, the hint the auto-tagger's JEV gets).
// The hourly job below does save one, only for a tag with no description or one the job wrote itself (`describedBy`,
// lib/tags.js replaceable): drawn from the notes the owner filed under it by hand, first at 3 of them, then each time they
// double (lib/tags.js due). A description saved through the API is the owner's, unless the request marks it an agent's
// (the request hooks below), and the job never writes over either: it re-reads the tag in the transaction that saves it
// and drops its answer when the tag was renamed or described by someone meanwhile (lib/tags.js saveDescription). The job's descriptions are not in the auto-tagger's definitions hash, so a new one is
// used for the notes asked about from then on and sends no note back to be asked again; the owner's own edit does.
//
// POST /api/tefnotes/tags/describe JSON { tag: "<name>" } | { all: true }
// 200 { tag, description }                    one tag (its name as sent); description is at most 400 characters, drawn
//                                             from the hand-tagged notes, or from any that carry the tag when none are
// 200 [{ tag, description }, ...]             `all`: every defined tag that has at least one note, in name order; one
//                                             the model failed on is left out (the log says which)
// 400 bad body, 404 no note carries the tag, 502 the model refused or failed (for `all`: for every tag), 503 no key.
// Errors are { error }. The key is the `llm` one (lib/keys.js), read on every use; never logged:
// a failure logs its status, as `tags:` lines.
//
// A handler runs in its own VM and sees nothing of this file's top level: it requires what it uses.
//
// POST /api/tefnotes/tags/rename JSON { from: "<name>", to: "<new name>" }
// Renames a tag everywhere, in one transaction: every note's tags line (its text, the `tags` column, what the
// auto-tagger added, `autotagged`) and every task's tags, each a write that bumps `rev` like any other (lib/records.js); every lens's
// tags and hidden tags; the notes list's folded groups in the preferences; and the definition. A `to` already defined
// (case and tonos ignored) merges the two: the existing definition stays, taking the other's colour and description
// where it has none, and the other is deleted; the items take its name as written there. A `from` nothing defines is
// still renamed on the items that carry it.
// 200 { tag, notes, tasks, lenses, merged }   tag: the name the items carry now; the counts of records changed
// 400 bad body. Errors are { error }.
routerAdd("POST", "/api/tefnotes/tags/rename", (e) => require(`${__hooks}/lib/http.js`).route(e, "tags", "The tag could not be renamed.", () => {
  const lib = require(`${__hooks}/lib/tags.js`), notes = require(`${__hooks}/lib/notes.js`), records = require(`${__hooks}/lib/records.js`);
  let req;
  try { req = lib.renameInput(e.requestInfo().body); } catch (err) {
    if (err instanceof lib.Bad) return e.json(400, { error: err.message });
    throw err;
  }
  const { names } = require(`${__hooks}/lib/rows.js`);
  const out = { tag: req.to, notes: 0, tasks: 0, lenses: 0, merged: false };
  e.app.runInTransaction((tx) => {
    const defs = tx.findAllRecords("tags").map((r) => ({ id: r.id, name: r.getString("name"), color: r.getString("color"), description: r.getString("description"), describedBy: r.getString("describedBy") }));
    const plan = lib.mergeDefs(defs, req.from, req.to);
    const to = plan.merged ? plan.keep.name : req.to;
    out.tag = to; out.merged = plan.merged;
    if (plan.drop) tx.delete(tx.findRecordById("tags", plan.drop.id));
    if (plan.keep) {
      const rec = tx.findRecordById("tags", plan.keep.id);
      rec.set("name", plan.keep.name); rec.set("color", plan.keep.color); rec.set("description", plan.keep.description);
      if (plan.merged) rec.set("describedBy", plan.keep.describedBy);
      tx.save(rec);
    }

    const ids = (coll) => {
      const rows = arrayOf(new DynamicModel({ id: "", tags: "" }));
      tx.db().newQuery(`SELECT id, CAST(IFNULL(tags, '[]') AS TEXT) AS tags FROM ${coll}`).all(rows);
      return rows.filter((r) => lib.renamed(names(r.tags), req.from, to)).map((r) => r.id);
    };
    // A note's `tags` column is a copy of its frontmatter, which lib/records.js copies out of the text again: a note whose
    // column alone carried the old name is rewritten all the same, which puts the copy right.
    for (const id of ids("notes")) {
      records.casWrite(tx, "notes", id, (rec) => {
        const path = rec.getString("path"), next = lib.renamed(notes.parse(path, rec.getString("text")).tags, req.from, to);
        if (next) rec.set("text", notes.withTags(path, rec.getString("text"), next));
        const auto = lib.renamed(names(rec.getString("autotagged")), req.from, to);
        if (auto) rec.set("autotagged", auto);
      });
      out.notes++;
    }
    for (const id of ids("tasks")) {
      records.casWrite(tx, "tasks", id, (rec) => { rec.set("tags", lib.renamed(names(rec.getString("tags")), req.from, to)); });
      out.tasks++;
    }
    for (const rec of tx.findAllRecords("lenses")) {
      const tags = lib.renamed(names(rec.getString("tags")), req.from, to), exclude = lib.renamed(names(rec.getString("exclude")), req.from, to);
      if (!tags && !exclude) continue;
      if (tags) rec.set("tags", tags);
      if (exclude) rec.set("exclude", exclude);
      tx.save(rec);
      out.lenses++;
    }
    let prefs = null;
    try { prefs = tx.findFirstRecordByFilter("prefs", "key = 'owner'"); } catch (_) { /* none yet */ }
    if (prefs) {
      let data = null;
      try { data = JSON.parse(prefs.getString("data") || "null"); } catch (_) { /* unreadable: left */ }
      const folded = data && data.notes && Array.isArray(data.notes.collapsed) ? lib.renamed(data.notes.collapsed.filter((s) => typeof s === "string"), req.from, to) : null;
      if (folded) { data.notes.collapsed = folded; prefs.set("data", data); tx.save(prefs); }
    }
  });
  e.app.logger().info("tags: renamed", "from", req.from, "to", out.tag, "notes", out.notes, "tasks", out.tasks, "lenses", out.lenses, "merged", out.merged);
  return e.json(200, out);
}));

routerAdd("POST", "/api/tefnotes/tags/describe", (e) => require(`${__hooks}/lib/http.js`).route(e, "tags", "The descriptions could not be written.", () => {
  const lib = require(`${__hooks}/lib/tags.js`), ds = require(`${__hooks}/lib/llm.js`).llm(), keys = require(`${__hooks}/lib/keys.js`);
  const log = (msg, ...kv) => e.app.logger().warn(`tags: ${msg}`, ...kv);

  let req;
  try { req = lib.input(e.requestInfo().body); } catch (err) {
    if (err instanceof lib.Bad) return e.json(400, { error: err.message });
    throw err;
  }
  const key = ds.credential(keys.read);
  if (!key) { log(`no ${ds.label} key: nothing described`); return e.json(503, { error: `The server has no ${ds.label} key.` }); }

  try {
    const have = require(`${__hooks}/lib/rows.js`).noteTags(e.app);

    const describe = (name) => lib.describe(e.app, ds, key, have, name, log, true);

    if (!req.all) {
      const r = describe(req.tag);
      if (r.none) return e.json(404, { error: `No note carries the tag “${req.tag}”.` });
      if (r.failed) return e.json(502, { error: "The description could not be written." });
      return e.json(200, { tag: req.tag, description: r.description });
    }
    const names = e.app.findAllRecords("tags").map((r) => r.getString("name").trim()).filter(Boolean).sort((a, b) => a.localeCompare(b));
    const out = [];
    let failed = 0;
    for (const name of names) {
      const r = describe(name);
      if (r.failed) failed++;
      else if (!r.none) out.push({ tag: name, description: r.description });
    }
    if (failed && !out.length) return e.json(502, { error: "No description could be written." });
    return e.json(200, out);
  } catch (err) {
    log("describe failed", "error", String(err).slice(0, 300));
    return e.json(500, { error: "The descriptions could not be written." });
  }
}));

cronAdd("tag-describe", "17 * * * *", () => {
  const lib = require(`${__hooks}/lib/tags.js`), ds = require(`${__hooks}/lib/llm.js`).llm(), keys = require(`${__hooks}/lib/keys.js`);
  const log = (msg, ...kv) => $app.logger().warn(`tags: ${msg}`, ...kv);
  const key = ds.credential(keys.read);
  if (!key) return;
  const have = require(`${__hooks}/lib/rows.js`).noteTags($app);
  for (const rec of $app.findAllRecords("tags")) {
    const name = rec.getString("name").trim(), n = lib.count(have, name);
    if (!name || !lib.due(n, rec.getInt("described"), rec.getString("describedBy"))) continue;
    const r = lib.describe($app, ds, key, have, name, log);
    if (!r.description) continue;                                 // failed: the next hour tries again
    // The model took a while: the tag is read again where it is written, and left alone if it moved meanwhile
    let saved = false;
    try {
      $app.runInTransaction((tx) => { saved = lib.saveDescription(tx, rec.id, name, r.description, n); });
      log(saved ? "described" : "renamed or described meanwhile: left as it is", "tag", name, "notes", n);
    } catch (err) { log("saving the description failed", "tag", name, "error", String(err).slice(0, 200)); }
  }
});

// Who wrote a description that arrives through the API, decided here and nowhere else: "agent" when the request says
// so (an outside agent: the CLI under TEF_NOTES_AGENT=1), else the owner's (the tag editors). A client can only lower
// the trust: "owner" and "auto" are never taken from a request, and a write that leaves the description as it was
// leaves `describedBy` too. Only the owner's is trusted: the auto-tagger's definitions hash holds it (lib/autotag.js).
// The hourly job above writes over neither the owner's nor an agent's. The job's own save is no request, so it fires neither hook.
onRecordCreateRequest((e) => {
  const by = e.requestInfo().body["describedBy"] === "agent" ? "agent" : "owner";
  e.record.set("describedBy", e.record.getString("description").trim() ? by : "");
  e.next();
}, "tags");

onRecordUpdateRequest((e) => {
  const was = e.record.original();
  if (e.record.getString("description") === was.getString("description")) e.record.set("describedBy", was.getString("describedBy"));
  else e.record.set("describedBy", e.requestInfo().body["describedBy"] === "agent" ? "agent" : "owner");
  e.next();
}, "tags");
