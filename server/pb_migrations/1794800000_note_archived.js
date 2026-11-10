/// <reference path="../pb_data/types.d.ts" />
// notes.archived: a copy of the frontmatter's `archived: true` (packages/core/src/notes.ts Flags), written by the clients beside
// `text` as `pinned` is. An archived note is out of the lists and the agent's index, still found by search and links. No note
// carries the key yet, so nothing to fill in.
migrate((app) => {
  const c = app.findCollectionByNameOrId("notes");
  c.fields.add(new BoolField({ name: "archived" }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("notes");
  c.fields.removeByName("archived");
  app.save(c);
});
