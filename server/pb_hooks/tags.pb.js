/// <reference path="../pb_data/types.d.ts" />
// Tag descriptions written from the notes that carry the tag, for the tag editors (phone, web, CLI): the logic is
// lib/tags.js, the server's model (lib/llm.js, its one writing model). The route writes nothing: the client shows the text
// and saves it with the tag the normal way (the `tags` collection's `description`, the hint the auto-tagger's JEV gets).
// The hourly job below does save one: a defined tag that EVERY (10) more notes carry than when its description was last
// written (`described`) gets a new one, in place of whatever was there, hand-written or not. A new description changes
// the auto-tagger's definitions hash, so every note is asked about again, as after a hand edit.
//
// POST /api/tefnotes/tags/describe JSON { tag: "<name>" } | { all: true }
// 200 { tag, description }                    one tag (its name as sent); description is at most 400 characters
// 200 [{ tag, description }, ...]             `all`: every defined tag that has at least one note, in name order; one
//                                             the model failed on is left out (the log says which)
// 400 bad body, 404 no note carries the tag, 502 the model refused or failed (for `all`: for every tag), 503 no key.
// Errors are { error }. The key is the `llm` one (lib/keys.js), read on every use; never logged:
// a failure logs its status, as `tags:` lines.
//
// A handler runs in its own VM and sees nothing of this file's top level: it requires what it uses.
routerAdd("POST", "/api/tefnotes/tags/describe", (e) => {
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
    const have = lib.rows(e.app);

    const describe = (name) => lib.describe(e.app, ds, key, have, name, log);

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
});

cronAdd("tag-describe", "17 * * * *", () => {
  const lib = require(`${__hooks}/lib/tags.js`), ds = require(`${__hooks}/lib/llm.js`).llm(), keys = require(`${__hooks}/lib/keys.js`);
  const log = (msg, ...kv) => $app.logger().warn(`tags: ${msg}`, ...kv);
  const key = ds.credential(keys.read);
  if (!key) return;
  const have = lib.rows($app);
  for (const rec of $app.findAllRecords("tags")) {
    const name = rec.getString("name").trim(), n = lib.count(have, name);
    if (!name || !lib.due(n, rec.getInt("described"))) continue;
    const r = lib.describe($app, ds, key, have, name, log);
    if (!r.description) continue;                                 // failed: the next hour tries again
    rec.set("description", r.description);
    rec.set("described", n);
    try { $app.save(rec); log("described", "tag", name, "notes", n); } catch (err) { log("saving the description failed", "tag", name, "error", String(err).slice(0, 200)); }
  }
});
