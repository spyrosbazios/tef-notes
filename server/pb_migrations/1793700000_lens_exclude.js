/// <reference path="../pb_data/types.d.ts" />
// lenses.exclude: tags a lens hides (packages/core/src/lens.ts `inLens`). An item is in a lens when it carries any of its
// `tags` (any item, when there are none) and none of these.
migrate((app) => {
  const c = app.findCollectionByNameOrId("lenses");
  c.fields.add(new JSONField({ name: "exclude", maxSize: 10000 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("lenses");
  c.fields.removeByName("exclude");
  app.save(c);
});
