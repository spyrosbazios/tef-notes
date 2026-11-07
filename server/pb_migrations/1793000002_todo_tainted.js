/// <reference path="../pb_data/types.d.ts" />
// `tainted` on tasks and projects, as on notes (1792600000_chats.js): the chat agent sets it in the same write when it
// writes one with web text in view, never clears it, and no client sends it. A tainted record read back counts as
// reading the web, so that chat's next write asks first (server/agent/src/agent.ts).
migrate((app) => {
  for (const n of ["tasks", "projects"]) {
    const c = app.findCollectionByNameOrId(n);
    c.fields.add(new BoolField({ name: "tainted" }));
    app.save(c);
  }
}, (app) => {
  for (const n of ["tasks", "projects"]) {
    const c = app.findCollectionByNameOrId(n);
    c.fields.removeByName("tainted");
    app.save(c);
  }
});
