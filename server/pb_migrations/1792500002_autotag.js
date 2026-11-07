/// <reference path="../pb_data/types.d.ts" />
// The auto-tagger's columns on notes (pb_hooks/autotag.pb.js writes all three; a client only ever reads them, and
// accepts a suggestion by adding the tag to the note's frontmatter, as any edit):
//   suggested   tag names it thinks likely (0.5 <= p < 0.85): the clients offer them as chips
//   autotagged  tag names it ever added: never added or suggested again, so one taken off by hand stays off
//   tagged      "<rev>:<hash of the tag definitions>" the note was last evaluated at, and what the cron compares
migrate((app) => {
  const c = app.findCollectionByNameOrId("notes");
  c.fields.add(new JSONField({ name: "suggested", maxSize: 10000 }));
  c.fields.add(new JSONField({ name: "autotagged", maxSize: 10000 }));
  c.fields.add(new TextField({ name: "tagged", max: 100 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("notes");
  for (const n of ["suggested", "autotagged", "tagged"]) c.fields.removeByName(n);
  app.save(c);
});
