/// <reference path="../pb_data/types.d.ts" />
// prefs gets `rev`, the compare-and-swap of pb_hooks/rev.pb.js (1794400000_prefs.js made the record with none: edited whole,
// the last save won, so two devices undid each other's settings). A write now names the rev it was based on and is refused
// (409) when the record has moved on; the clients read again and send their changed paths over the newer one
// (packages/core/src/prefs-sync.ts). The record that exists starts at rev 1, as a created one does.
migrate((app) => {
  const c = app.findCollectionByNameOrId("prefs");
  c.fields.add(new NumberField({ name: "rev", onlyInt: true, min: 1 }));
  app.save(c);
  for (const rec of app.findAllRecords("prefs")) {
    rec.set("rev", 1);
    app.save(rec);
  }
}, (app) => {
  const c = app.findCollectionByNameOrId("prefs");
  c.fields.removeByName("rev");
  app.save(c);
});
