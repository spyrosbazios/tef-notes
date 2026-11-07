/// <reference path="../pb_data/types.d.ts" />
// lenses: the owner's saved filters (packages/core/src/lens.ts). A lens is a name and a set of tags; while a device has one
// on, it shows only the notes and tasks carrying any of them. Only the definitions live here, so every device has the same
// ones; which lens is on is each device's own. Like `tags` (1792500000_tags.js): open rules, the tailnet is the gate, and no
// `rev` (a lens is edited whole; the last save wins). Names are unique ignoring case.
migrate((app) => {
  app.save(new Collection({
    name: "lenses", type: "base", listRule: "", viewRule: "", createRule: "", updateRule: "", deleteRule: "",
    fields: [
      { name: "name", type: "text", required: true, min: 1, max: 40 },
      { name: "tags", type: "json", maxSize: 10000 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_lenses_name ON lenses (name COLLATE NOCASE)"],
  }));
}, (app) => {
  app.delete(app.findCollectionByNameOrId("lenses"));
});
