/// <reference path="../pb_data/types.d.ts" />
// notes.tasks under the rule that a plain checkbox is not a task (the root AGENTS.md, "Tasks"): only a box with braces,
// or a top-level box of the Inbox, and the note itself when its frontmatter schedules it. Recomputed from each note's
// text, which doesn't change, by SQL: a record save would bump `updated` and reorder every list.
migrate((app) => {
  const notes = require(`${__hooks}/lib/notes.js`);
  for (const r of app.findAllRecords("notes")) {
    const tasks = notes.taskIndex(r.getString("path"), r.getString("text"));
    app.db().newQuery("UPDATE notes SET tasks = {:tasks} WHERE id = {:id}").bind({ tasks: JSON.stringify(tasks), id: r.id }).execute();
  }
}, () => {
  // Nothing to undo: the column was a copy of the text either way.
});
