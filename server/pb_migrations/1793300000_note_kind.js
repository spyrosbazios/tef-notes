/// <reference path="../pb_data/types.d.ts" />
// notes.kind: what a note is, `note` or `capture` (a screenshot capture: pb_hooks/screenshots.pb.js), a select that grows
// as kinds are added. Until now a capture was told by its path (`notes/YYYYMMDD-shots-HHMMSS.md`); from here the column is
// the truth and nothing reads a kind out of a path. Set once, when the note is made, and never changed (notes.pb.js: a
// create without one is a `note`, so a client that predates the column still makes notes). Filled here from the path, the
// one place that may, by SQL: a record save would bump `updated` and reorder every list.
const CAPTURE_PATH = /^notes\/\d{8}-shots-\d{6}(-\d+)?\.md$/;

migrate((app) => {
  const c = app.findCollectionByNameOrId("notes");
  c.fields.add(new SelectField({ name: "kind", required: true, maxSelect: 1, values: ["note", "capture"] }));
  c.addIndex("idx_notes_kind", false, "kind", "");
  app.save(c);
  for (const r of app.findAllRecords("notes")) {
    const kind = CAPTURE_PATH.test(r.getString("path")) ? "capture" : "note";
    app.db().newQuery("UPDATE notes SET kind = {:kind} WHERE id = {:id}").bind({ kind, id: r.id }).execute();
  }
}, (app) => {
  const c = app.findCollectionByNameOrId("notes");
  c.removeIndex("idx_notes_kind");
  c.fields.removeByName("kind");
  app.save(c);
});
