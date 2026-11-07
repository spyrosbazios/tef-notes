/// <reference path="../pb_data/types.d.ts" />
// links: one record per relation between two records, `from` → `to` with a `role`, in place of the single `tasks.note`
// (which goes here, its values moved over). Many notes per task, what links to a note (its backlinks), a note made from a
// capture or a shot. The ends are typed relations, one column per kind of record on each side, exactly one of each side
// set (pb_hooks/links.pb.js, lib/links.js):
//   fromNote fromTask fromShot   the record the link is from: a task about a note, a note made from a capture
//   toNote   toTask   toShot     the record it points at
//   role                         `about` (from is about to: a task about a note) or `source` (from was made from to: a note
//                                or a task made from a capture or a shot); grows as uses are added
// Why typed relations and not a generic (type, id) pair: PocketBase checks a relation points at a record that exists,
// deletes the link when either end is deleted (cascadeDelete, also down a cascade: a project's tasks, a capture's shots),
// and expands and back-relates them (`links_via_toNote`) in one request; a free-text id would need a hook for each and
// would dangle where one is missed. Empty relations are stored as "", so the unique index holds over one link per
// (from, to, role).
// A link is never edited (no update rule): it is made or deleted, both idempotent for a client (a create whose id or
// whose (from, to, role) exists is the one it meant; a delete of one gone is done). It carries no `rev`: it holds no text
// to merge, and a link made or removed changes neither end, so neither end's `rev` moves; a client syncs links as a set
// of ids (an id never changes what it points at). Open rules like the rest (1792400000_open.js).
const SIDES = ["from", "to"];
const TYPES = { Note: "notes", Task: "tasks", Shot: "screenshots" };

migrate((app) => {
  const fields = [];
  for (const side of SIDES) for (const [type, col] of Object.entries(TYPES)) {
    fields.push({ name: `${side}${type}`, type: "relation", collectionId: app.findCollectionByNameOrId(col).id, maxSelect: 1, cascadeDelete: true });
  }
  fields.push({ name: "role", type: "select", required: true, maxSelect: 1, values: ["about", "source"] });
  fields.push({ name: "created", type: "autodate", onCreate: true });
  const links = new Collection({
    name: "links", type: "base", listRule: "", viewRule: "", createRule: "", updateRule: null, deleteRule: "",
    fields,
    indexes: [
      "CREATE UNIQUE INDEX idx_links_unique ON links (fromNote, fromTask, fromShot, toNote, toTask, toShot, role)",
      "CREATE INDEX idx_links_from_task ON links (fromTask)",
      "CREATE INDEX idx_links_from_shot ON links (fromShot)",
      "CREATE INDEX idx_links_to_note ON links (toNote)",
      "CREATE INDEX idx_links_to_task ON links (toTask)",
      "CREATE INDEX idx_links_to_shot ON links (toShot)",
    ],
  });
  app.save(links);

  // Every task's note, as a link about it. A note id the relation still holds but no note has is left behind.
  const rows = arrayOf(new DynamicModel({ id: "", note: "" }));
  app.db().newQuery("SELECT t.id AS id, t.note AS note FROM tasks t JOIN notes n ON n.id = t.note WHERE IFNULL(t.note, '') != ''").all(rows);
  for (const r of rows) {
    const l = new Record(links);
    l.set("fromTask", r.id);
    l.set("toNote", r.note);
    l.set("role", "about");
    app.save(l);
  }

  const tasks = app.findCollectionByNameOrId("tasks");
  tasks.fields.removeByName("note");
  app.save(tasks);
}, (app) => {
  // Back to one note per task: of a task's `about` links to notes, the oldest. Every other link is lost with the collection.
  const tasks = app.findCollectionByNameOrId("tasks"), notes = app.findCollectionByNameOrId("notes");
  tasks.fields.add(new RelationField({ name: "note", collectionId: notes.id, maxSelect: 1, cascadeDelete: false }));
  app.save(tasks);
  const rows = arrayOf(new DynamicModel({ task: "", note: "" }));
  app.db().newQuery("SELECT fromTask AS task, toNote AS note FROM links WHERE fromTask != '' AND toNote != '' AND role = 'about' ORDER BY created, id").all(rows);
  for (const r of rows) {
    app.db().newQuery("UPDATE tasks SET note = {:note} WHERE id = {:task} AND IFNULL(note, '') = ''").bind({ note: r.note, task: r.task }).execute();
  }
  app.delete(app.findCollectionByNameOrId("links"));
});
