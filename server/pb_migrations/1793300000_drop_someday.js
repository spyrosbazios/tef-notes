/// <reference path="../pb_data/types.d.ts" />
// Someday is gone: a task is scheduled on a day or not at all. A task that was parked keeps its other fields and shows
// in the Inbox, or only in its project when it has one.
migrate((app) => {
  const c = app.findCollectionByNameOrId("tasks");
  c.fields.removeByName("someday");
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("tasks");
  c.fields.add(new BoolField({ name: "someday" }));
  app.save(c);
});
