/// <reference path="../pb_data/types.d.ts" />
// The auto-tagger no longer suggests (pb_hooks/autotag.pb.js). Notes: every tag it judges likelier than not it adds
// itself; `suggested` goes and `tagged` is cleared, so every note is asked again under that rule (`autotagged` stays, so
// a tag once removed by hand is still never re-added). Tasks: tagged only while being typed, never by the cron, so
// their `suggested`, `autotagged` and `tagged` go. A task's pending suggestions become tags first (rev + 1, as an edit),
// so what the old rule offered is not lost.
migrate((app) => {
  const names = (raw) => {
    try { const v = JSON.parse(raw || "null"); return Array.isArray(v) ? v.filter((s) => typeof s === "string") : []; } catch (_) { return []; }
  };
  const fold = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const rows = arrayOf(new DynamicModel({ id: "", tags: "", suggested: "" }));
  app.db().newQuery("SELECT id, CAST(IFNULL(tags, '[]') AS TEXT) AS tags, CAST(IFNULL(suggested, '[]') AS TEXT) AS suggested FROM tasks").all(rows);
  for (const r of rows) {
    const tags = names(r.tags), have = tags.map(fold);
    const add = names(r.suggested).filter((n) => !have.includes(fold(n)));
    if (!add.length) continue;
    app.db().newQuery("UPDATE tasks SET tags = {:tags}, rev = rev + 1 WHERE id = {:id}")
      .bind({ tags: JSON.stringify(tags.concat(add)), id: r.id }).execute();
  }

  const tasks = app.findCollectionByNameOrId("tasks");
  for (const n of ["suggested", "autotagged", "tagged"]) tasks.fields.removeByName(n);
  app.save(tasks);

  const notes = app.findCollectionByNameOrId("notes");
  notes.fields.removeByName("suggested");
  app.save(notes);
  app.db().newQuery("UPDATE notes SET tagged = ''").execute();
}, (app) => {
  const notes = app.findCollectionByNameOrId("notes");
  notes.fields.add(new JSONField({ name: "suggested", maxSize: 10000 }));
  app.save(notes);
  const tasks = app.findCollectionByNameOrId("tasks");
  tasks.fields.add(new JSONField({ name: "suggested", maxSize: 10000 }));
  tasks.fields.add(new JSONField({ name: "autotagged", maxSize: 10000 }));
  tasks.fields.add(new TextField({ name: "tagged", max: 64 }));
  app.save(tasks);
});
