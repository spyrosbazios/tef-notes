/// <reference path="../pb_data/types.d.ts" />
// tags.describedBy gains "agent": a description an outside agent saved (the CLI under TEF_NOTES_AGENT=1). Like "auto",
// it is not the owner's: the auto-tagger's definitions hash leaves it out, the chat agent treats it as untrusted, and the
// hourly job may write over it. pb_hooks/tags.pb.js decides the value on every request; nothing existing changes.
migrate((app) => {
  const c = app.findCollectionByNameOrId("tags");
  c.fields.getByName("describedBy").values = ["owner", "auto", "agent"];
  app.save(c);
}, (app) => {
  for (const rec of app.findRecordsByFilter("tags", "describedBy = 'agent'", "", 0, 0)) {
    rec.set("describedBy", "auto");
    app.save(rec);
  }
  const c = app.findCollectionByNameOrId("tags");
  c.fields.getByName("describedBy").values = ["owner", "auto"];
  app.save(c);
});
