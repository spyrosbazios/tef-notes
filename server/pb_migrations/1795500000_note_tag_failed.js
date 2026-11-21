/// <reference path="../pb_data/types.d.ts" />
// notes.tagFailed: the auto-tagger's record of a note JEV keeps refusing (pb_hooks/autotag.pb.js, lib/autotag.js failed):
// `{ rev, hash, n, next }`, the note's rev and the definitions' hash it failed in, how many times, and when it may be asked
// again. Only the cron writes it, a client only ever ignores it; a new rev or new definitions make it stale. Additive: every
// note starts without one, as never tried.
migrate((app) => {
  const c = app.findCollectionByNameOrId("notes");
  c.fields.add(new JSONField({ name: "tagFailed", maxSize: 1000 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("notes");
  c.fields.removeByName("tagFailed");
  app.save(c);
});
