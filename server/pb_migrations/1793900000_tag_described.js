/// <reference path="../pb_data/types.d.ts" />
// tags.described: how many notes carried the tag when its description was last written by the hourly job (tags.pb.js);
// it writes a new one once lib/tags.js EVERY more do. A tag that already has a description starts from the notes that
// carry it now, so none is rewritten on deploy; one without starts from 0, so a tag already on 10 notes gets one at once.
migrate((app) => {
  const c = app.findCollectionByNameOrId("tags");
  c.fields.add(new NumberField({ name: "described", onlyInt: true, min: 0 }));
  app.save(c);
  const rows = arrayOf(new DynamicModel({ tags: "" }));
  app.db().newQuery("SELECT CAST(IFNULL(tags, '[]') AS TEXT) AS tags FROM notes WHERE path LIKE 'notes/%'").all(rows);
  const fold = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const counts = new Map();
  for (const r of rows) {
    let v; try { v = JSON.parse(r.tags || "[]"); } catch (_) { v = []; }
    if (!Array.isArray(v)) continue;
    for (const k of new Set(v.filter((t) => typeof t === "string").map(fold))) counts.set(k, (counts.get(k) || 0) + 1);
  }
  for (const rec of app.findAllRecords("tags")) {
    if (!rec.getString("description").trim()) continue;
    rec.set("described", counts.get(fold(rec.getString("name").trim())) || 0);
    app.save(rec);
  }
}, (app) => {
  const c = app.findCollectionByNameOrId("tags");
  c.fields.removeByName("described");
  app.save(c);
});
