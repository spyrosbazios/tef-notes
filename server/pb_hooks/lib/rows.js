// What several hooks read out of the database the same way: a JSON list of names (a `tags` or `autotagged` column, a
// lens's tags), a few of a list spread over it, and every note's tags as the auto-tagger and the tag describer learn from
// them. One copy each (test/rows.test.js). Plain CommonJS: a handler `require`s it (a handler runs in a VM of its own).

/** The names in a list column's value: its JSON text (as a raw query or `getString` gives it) or a list already; [] for
 *  anything else. Only strings are kept. */
function names(raw) {
  let v = raw;
  if (typeof v === "string") { try { v = JSON.parse(v || "[]"); } catch (_) { return []; } }
  return Array.isArray(v) ? v.filter((s) => typeof s === "string") : [];
}

/** `n` of `list` spread over it: the first, the last and evenly between, so a few examples aren't all last week's. */
function spread(list, n) {
  if (list.length <= n) return list;
  if (n === 1) return [list[0]];
  return Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))]);
}

/** Every note's `{ id, path, title, tags, autotagged, updated }` from `app`'s database (hooks only): the notes under
 *  `notes/`, their tags and the auto-tagger's as lists, `updated` PocketBase's text. */
function noteTags(app) {
  const out = arrayOf(new DynamicModel({ id: "", path: "", title: "", tags: "", autotagged: "", updated: "" }));
  app.db().newQuery("SELECT id, path, title, CAST(IFNULL(tags, '[]') AS TEXT) AS tags, CAST(IFNULL(autotagged, '[]') AS TEXT) AS autotagged, updated FROM notes WHERE path LIKE 'notes/%'").all(out);
  return out.map((r) => ({ id: r.id, path: r.path, title: r.title, tags: names(r.tags), autotagged: names(r.autotagged), updated: r.updated }));
}

module.exports = { names, spread, noteTags };
