/// <reference path="../pb_data/types.d.ts" />
// tags.describedBy: who wrote a tag's description, "owner" (saved through the API: pb_hooks/tags.pb.js marks it) or
// "auto" (the hourly job, which never writes over the owner's); "" for none. The auto-tagger's definitions hash holds
// only the owner's (lib/autotag.js defsHash).
//
// The data: a description written at 10 or more notes (`described`) was the job's: "auto", and `described` back to 0 so
// the job writes it once more from the notes tagged by hand (lib/tags.js due). Any other is the owner's.
migrate((app) => {
  const c = app.findCollectionByNameOrId("tags");
  c.fields.add(new SelectField({ name: "describedBy", values: ["owner", "auto"], maxSelect: 1 }));
  app.save(c);
  for (const rec of app.findAllRecords("tags")) {
    if (!rec.getString("description").trim()) continue;
    if (rec.getInt("described") >= 10) { rec.set("describedBy", "auto"); rec.set("described", 0); }
    else rec.set("describedBy", "owner");
    app.save(rec);
  }
}, (app) => {
  const c = app.findCollectionByNameOrId("tags");
  c.fields.removeByName("describedBy");
  app.save(c);
});
