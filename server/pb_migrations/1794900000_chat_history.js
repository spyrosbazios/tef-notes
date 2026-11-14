/// <reference path="../pb_data/types.d.ts" />
// Add a format marker without rewriting messages. Existing records read as version zero.
migrate((app) => {
  const c = app.findCollectionByNameOrId("chats");
  c.fields.add(new NumberField({ name: "historyVersion", min: 0, onlyInt: true }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("chats");
  c.fields.removeByName("historyVersion");
  app.save(c);
});
