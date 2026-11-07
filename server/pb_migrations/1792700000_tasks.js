/// <reference path="../pb_data/types.d.ts" />
// notes.tasks: the note's tasks (its checkbox lines, the format in the root AGENTS.md), a copy of its text the clients
// write beside it like the frontmatter columns (mobile/src/core/tasks.ts taskIndex, mirrored by lib/notes.js). Filled
// here for the notes already there, by SQL: a record save would bump `updated` and reorder every list.
migrate((app) => {
  const c = app.findCollectionByNameOrId("notes");
  c.fields.add(new JSONField({ name: "tasks", maxSize: 1000000 }));
  app.save(c);
  const notes = require(`${__hooks}/lib/notes.js`);
  for (const r of app.findAllRecords("notes")) {
    const tasks = notes.taskIndex(r.getString("path"), r.getString("text"));
    app.db().newQuery("UPDATE notes SET tasks = {:tasks} WHERE id = {:id}").bind({ tasks: JSON.stringify(tasks), id: r.id }).execute();
  }
}, (app) => {
  const c = app.findCollectionByNameOrId("notes");
  c.fields.removeByName("tasks");
  app.save(c);
});
