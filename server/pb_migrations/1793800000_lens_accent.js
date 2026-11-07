/// <reference path="../pb_data/types.d.ts" />
// lenses.accent: the primary colour the app takes while the lens is on (packages/core/src/lens.ts `lensAccent`, theme.ts
// `ACCENTS`); empty keeps the device's own.
migrate((app) => {
  const c = app.findCollectionByNameOrId("lenses");
  c.fields.add(new TextField({ name: "accent", max: 20 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("lenses");
  c.fields.removeByName("accent");
  app.save(c);
});
