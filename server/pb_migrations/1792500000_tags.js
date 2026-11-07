/// <reference path="../pb_data/types.d.ts" />
// tags: the owner's tag definitions (Settings). A note's own tags stay in its frontmatter, with the `tags` column on
// notes as the client-written copy; this collection only says which tags exist, their badge colour, and a
// `description` that is the hint the AI gets when it suggests tags. Names are unique ignoring case, so `Home` and
// `home` can't both exist. Open rules, like notes (1792400000_open.js): the tailnet is the gate.
migrate((app) => {
  app.save(new Collection({
    name: "tags", type: "base", listRule: "", viewRule: "", createRule: "", updateRule: "", deleteRule: "",
    fields: [
      { name: "name", type: "text", required: true, min: 1, max: 40 },
      { name: "color", type: "select", maxSelect: 1, values: ["yellow", "pink", "blue", "green", "purple", "gray"] },
      { name: "description", type: "text", max: 500 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_tags_name ON tags (name COLLATE NOCASE)"],
  }));
}, (app) => {
  app.delete(app.findCollectionByNameOrId("tags"));
});
