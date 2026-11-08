/// <reference path="../pb_data/types.d.ts" />
// prefs: the owner's preferences (packages/core/src/prefs.ts), shared by every device. One record, `key` "owner" (unique, so
// two devices creating it at once make one), its `data` a Prefs read defensively by the clients. Like `lenses`: open rules,
// the tailnet is the gate, and no `rev` (edited whole; the last save wins).
migrate((app) => {
  app.save(new Collection({
    name: "prefs", type: "base", listRule: "", viewRule: "", createRule: "", updateRule: "", deleteRule: "",
    fields: [
      { name: "key", type: "text", required: true, min: 1, max: 40 },
      { name: "data", type: "json", maxSize: 20000 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_prefs_key ON prefs (key)"],
  }));
}, (app) => {
  app.delete(app.findCollectionByNameOrId("prefs"));
});
