/// <reference path="../pb_data/types.d.ts" />
// Tags on tasks, the columns notes have (1792300000_init.js, 1792500002_autotag.js), so the auto-tagger covers both:
//   tags        tag names; written by clients (a hand edit, an accepted suggestion) and by pb_hooks/autotag.pb.js, each
//               a normal `rev` write. A task has no frontmatter, so this column is the one copy.
//   suggested   tag names the auto-tagger thinks likely (0.5 <= p < 0.85): the clients offer them as chips. The server's:
//               a client reads it, and its writes leave it as it was. Unlike a note's, a change to it bumps `rev`
//               (tasks sync by `rev` alone, there is no listing that carries it), and nothing else does.
//   autotagged  tag names it ever added: never added or suggested again, so one taken off by hand stays off
//   tagged      "<rev>:<hash of the tag definitions>" the task was last evaluated at, and what the cron compares
migrate((app) => {
  const c = app.findCollectionByNameOrId("tasks");
  c.fields.add(new JSONField({ name: "tags", maxSize: 10000 }));
  c.fields.add(new JSONField({ name: "suggested", maxSize: 10000 }));
  c.fields.add(new JSONField({ name: "autotagged", maxSize: 10000 }));
  c.fields.add(new TextField({ name: "tagged", max: 100 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("tasks");
  for (const n of ["tags", "suggested", "autotagged", "tagged"]) c.fields.removeByName(n);
  app.save(c);
});
