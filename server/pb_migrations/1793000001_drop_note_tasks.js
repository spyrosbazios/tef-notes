/// <reference path="../pb_data/types.d.ts" />
// notes.tasks goes: a note's tasks are `tasks` records now (1793000000_todo_from_notes.js), its text plain markdown.
migrate((app) => {
  const c = app.findCollectionByNameOrId("notes");
  c.fields.removeByName("tasks");
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("notes");
  c.fields.add(new JSONField({ name: "tasks", maxSize: 1000000 }));
  app.save(c);
});
