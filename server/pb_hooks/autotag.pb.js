/// <reference path="../pb_data/types.d.ts" />
// Auto-tagging, on the server so every client gets it and none holds a key. Two ways, both through JEV (TypeSafe's
// decision model, lib/autotag.js) with one yes/no question per tag definition:
//
// Notes: once a minute, up to BATCH notes whose `tagged` isn't their current state are asked about by their title and
// body. A tag at or above its cut (lib/autotag.js cutOf: 0.7, higher for a tag the owner keeps taking off) is written
// like a hand edit would: into the frontmatter (`text`, the `tags` copy), `rev` + 1, at most MAX_AUTO of the tagger's
// tags on a note. Nothing is only suggested: a wrong tag is removed by hand, and that removal is what teaches it: each
// question names notes the owner filed under the tag by hand and notes the owner took it off (lib/autotag.js profile).
//
// Tasks: only while one is being typed. POST /api/tefnotes/tags/guess { title, notes? } answers { tags } (likeliest
// first) and saves nothing; the clients call it debounced from the task form and put the tags on the draft, and what the
// form holds when it closes is the task's, never changed by the server afterwards. 503 without a key, 502 when JEV
// failed, 400 a bad body; no definitions or no title is { tags: [] }.
//
//   autotagged  json  every name this hook ever added to the record: never added again, so a tag taken off
//                     by hand stays off; the ones no longer on the note are the owner's "no" examples
//   tagged      text  "<rev>:<defs hash>:<text hash>" the note was last evaluated at (lib/autotag.js taggedKey). A new
//                     `rev` whose title and text are what was asked about (a tag taken off, a pin) is only re-stamped:
//                     asking again is how a removed tag used to be followed by another one. The definitions' hash holds
//                     the names and the owner's own descriptions, not the ones the server writes (lib/tags.js)
//
// Photos: a note's first PHOTOS embedded pictures (attachments records, JPEG or PNG) go to JEV beside its text, which
// is how a receipt, a whiteboard or a product shot gets its tags. TypeSafe rejects a whole request over one picture
// outside 280 to 1568 px a side, and the clients keep up to 1600: a picture too big is shrunk to fit with PocketBase's
// own thumbnailer (a temporary file beside the original, deleted at once), one too small, or that cannot be read, is
// left out (lib/images.js). If TypeSafe still answers 400 or 413 the note is asked again without them. A task has none.
//
// The key: lib/jev.js. Without it, or without definitions, nothing runs. A failed request leaves `tagged` alone, so the
// next run retries; the log gets its status, never the key. pb_migrations/1792500002_autotag.js adds the columns to
// notes, 1793500000_task_tags.js to tasks.
//
// The rev contract (rev.pb.js) is enforced by request hooks, and a save from here fires none of them, so the write goes
// through lib/records.js casWrite: read again inside a transaction and dropped if `rev` moved since it was read. The
// phone's write wins and this run's answer is forgotten; the next run asks again. A verdict with no tag to add (only
// `tagged`) is a plain UPDATE guarded by the same `rev`: no bump, and no new `updated`, which would float every note the
// backlog touches to the top of the lists (and sends no realtime event).

cronAdd("autotag", "* * * * *", () => {
  const jev = require(`${__hooks}/lib/jev.js`);
  const key = require(`${__hooks}/lib/keys.js`).read("typesafe");   // no key: tag nothing
  if (!key || $app.store().get("autotag-running")) return;     // a run still going when the next minute starts
  const lib = require(`${__hooks}/lib/autotag.js`), notes = require(`${__hooks}/lib/notes.js`), images = require(`${__hooks}/lib/images.js`), records = require(`${__hooks}/lib/records.js`);

  const defs = lib.load($app);
  if (!defs.length) return;
  const hash = lib.defsHash(defs);

  const names = (rec, field) => {
    try { const v = JSON.parse(rec.getString(field) || "null"); return Array.isArray(v) ? v.filter((s) => typeof s === "string") : []; } catch (err) { return []; }
  };
  const log = (msg, ...kv) => $app.logger().warn(`autotag: ${msg}`, ...kv);

  /** The note's pictures as `lib.requests` takes them: at most PHOTOS, in body order, each fitting what TypeSafe takes
   *  (one too big shrunk to fit). One that cannot be read or does not fit is left out, never a reason to skip the note. */
  const photosOf = (note) => {
    const out = [];
    let fsys = null;
    try {
      for (const { name, caption } of images.embedded(note.body, note.id).slice(0, lib.PHOTOS * 3)) {
        if (out.length === lib.PHOTOS) break;
        try {
          const att = $app.findFirstRecordByFilter("attachments", "note = {:n} && name = {:name}", { n: note.id, name });
          fsys = fsys || $app.newFilesystem();
          const look = images.lookOf(fsys, att);
          if (!look) continue;
          out.push({ ref: `photo-${$security.randomString(24)}`, format: look.format, data: look.data, caption });
        } catch (err) {
          log("photo skipped", "note", note.id, "photo", name, "error", String(err).slice(0, 200));
        }
      }
    } finally {
      if (fsys) fsys.close();
    }
    return out;
  };

  /** The notes to evaluate (`sql`, newest first) and, for one record, what is asked (`item`, as `lib.requests` takes
   *  it; `askable`: whether there is anything to ask about), the tags it has, its pictures (`photos()`), and
   *  `withTags(cur, tags)`: how those tags are written into the fresh record. */
  const NOTES = {
    coll: "notes", noun: "note",
    sql: "SELECT id FROM notes WHERE path LIKE 'notes/%' AND IFNULL(tagged, '') NOT LIKE CAST(CAST(rev AS INTEGER) AS TEXT) || ':' || {:hash} || ':%' ORDER BY updated DESC LIMIT {:n}",
    subject: (rec) => {
      const path = rec.getString("path"), text = rec.getString("text"), note = notes.parse(path, text);
      return {
        item: note, askable: !!note.body.trim(), tags: note.tags, photos: () => photosOf(note),
        withTags: (cur, tags) => { cur.set("text", notes.withTags(path, text, tags)); },
      };
    },
  };

  /** JEV's answer to one request, or null with the reason logged; `state.status` is its status. `down`: it is no use asking again this run. */
  const post = (body, who, id, state) => {
    let res;
    try {
      res = $http.send(jev.request(key, body));
    } catch (err) {
      state.down = true;
      log("request failed", who, id, "error", String(err).slice(0, 200));
      return null;
    }
    state.status = res.statusCode;
    if (res.statusCode === 200) return res.json;
    state.down = jev.down(res.statusCode);
    log("TypeSafe refused", who, id, "status", res.statusCode);
    return null;
  };

  const state = { down: false, status: 0 };

  /** One run over one collection: up to BATCH records whose `tagged` isn't their current state. */
  const evaluate = ({ coll, noun, sql, subject }) => {
    const rows = arrayOf(new DynamicModel({ id: "" }));
    $app.db().newQuery(sql).bind({ hash, n: lib.BATCH }).all(rows);
    let done = 0, added = 0;
    for (const { id } of rows) {
      if (state.down) break;
      try {
        const rec = $app.findRecordById(coll, id), rev = rec.getInt("rev"), had = names(rec, "autotagged");
        const sub = subject(rec), content = lib.contentKey(sub.item);
        // Only re-stamped, in the same guarded UPDATE as a verdict with nothing to add
        const stamp = (tx) => tx.db().newQuery(`UPDATE ${coll} SET tagged = {:tagged} WHERE id = {:id} AND rev = {:rev}`)
          .bind({ tagged: lib.taggedKey(rev, hash, content), id, rev }).execute();
        if (lib.fresh(rec.getString("tagged"), rev, hash, content)) { stamp($app); continue; }
        // Not asked about: what the record has, what the server added once already (and the owner may have removed);
        // nothing at all once the note carries MAX_AUTO of the tagger's tags
        const kept = lib.without(had, lib.without(had, sub.tags));   // the tagger's tags still on the note
        const room = lib.MAX_AUTO - kept.length;
        const open = sub.askable && room > 0 ? defs.filter((d) => lib.without([d.name], sub.tags.concat(had)).length) : [];

        const ask = (photos) => {
          const found = [];
          for (const req of lib.requests(sub.item, open, photos, id)) {
            const json = post(req.body, noun, id, state);
            if (!json) return null;
            found.push(...lib.probabilities(req.defs, json));
          }
          return found;
        };
        const photos = open.length ? sub.photos() : [];
        let found = ask(photos);
        if (!found && photos.length && (state.status === 400 || state.status === 413)) {
          log("TypeSafe refused the photos: asking by the text", noun, id, "photos", photos.length);
          found = ask([]);
        }
        if (!found) continue;                                   // `tagged` stays: next run asks again
        const add = lib.decide(found, defs, room);

        $app.runInTransaction((tx) => {
          if (add.length) {
            // Edited since it was read: that edit wins (nothing written), and the next run asks again
            const saved = records.casWrite(tx, coll, id, (cur) => {
              sub.withTags(cur, sub.tags.concat(lib.without(add, sub.tags)));
              cur.set("autotagged", had.concat(lib.without(add, had)));
              cur.set("tagged", lib.taggedKey(rev + 1, hash, content));
            }, { expectRev: rev });
            if (saved) { added += add.length; done++; }
          } else {
            // A verdict is not an edit, and a save stamps `updated` (which the lists sort by) however it is set
            stamp(tx);
            done++;
          }
        });
      } catch (err) {
        log(`${noun} skipped`, noun, id, "error", String(err).slice(0, 200));
      }
    }
    if (done) $app.logger().info("autotag: evaluated", coll, done, "tags added", added);
  };

  $app.store().set("autotag-running", true);
  try {
    evaluate(NOTES);
  } finally {
    $app.store().set("autotag-running", false);
  }
});

routerAdd("POST", "/api/tefnotes/tags/guess", (e) => require(`${__hooks}/lib/http.js`).route(e, "autotag", "The tags could not be guessed.", () => {
  const lib = require(`${__hooks}/lib/autotag.js`), jev = require(`${__hooks}/lib/jev.js`), keys = require(`${__hooks}/lib/keys.js`);
  const input = lib.guessInput(e.requestInfo().body);
  if (!input) return e.json(400, { error: "Send { title, notes? } as strings." });
  const key = keys.read("typesafe");
  if (!key) return e.json(503, { error: "The server has no TypeSafe key." });
  const defs = lib.load(e.app);
  if (!defs.length || !input.title) return e.json(200, { tags: [] });

  const ps = [];
  for (const r of lib.requests(lib.taskItem({ title: input.title, notes: input.notes, checklist: [] }), defs)) {
    let res;
    try { res = $http.send(jev.request(key, r.body, 15)); } catch (err) {
      e.app.logger().warn("autotag: guess failed", "error", String(err).slice(0, 200));
      return e.json(502, { error: "TypeSafe could not be reached." });
    }
    if (res.statusCode !== 200) {
      e.app.logger().warn("autotag: TypeSafe refused the guess", "status", res.statusCode);
      return e.json(502, { error: "TypeSafe refused." });
    }
    ps.push(...lib.probabilities(r.defs, res.json));
  }
  return e.json(200, { tags: lib.decide(ps, defs) });
}));
