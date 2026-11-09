/// <reference path="../pb_data/types.d.ts" />
// A task's place, as a note's `where:` (packages/core/src/places.ts `Place`: name, address, lat/lng, place_id), null for
// none. An ordinary field under the rev contract: written by clients and the agent's set_place, merged as one value.
migrate((app) => {
  const c = app.findCollectionByNameOrId("tasks");
  c.fields.add(new JSONField({ name: "where", maxSize: 2000 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("tasks");
  c.fields.removeByName("where");
  app.save(c);
});
