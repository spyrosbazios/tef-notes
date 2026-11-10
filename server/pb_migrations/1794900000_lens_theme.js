/// <reference path="../pb_data/types.d.ts" />
// lenses.theme: the theme the app takes while the lens is on (packages/core/src/lens.ts `lensTheme`, theme.ts `THEMES`);
// empty keeps the owner's own.
migrate((app) => {
  const c = app.findCollectionByNameOrId("lenses");
  c.fields.add(new TextField({ name: "theme", max: 20 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("lenses");
  c.fields.removeByName("theme");
  app.save(c);
});
