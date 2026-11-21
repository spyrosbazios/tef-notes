/// <reference path="../pb_data/types.d.ts" />
// `clip_saves`: the clip saves already done (server/pb_hooks/clip.pb.js). A client makes an `id` for each save it sends (the
// extension, the web's share page, the Android companion's outbox, which keeps it across re-sends) and the record is created
// under that id in the transaction that does the save, holding the answer that went back. A save sent again (the answer was
// lost, or the phone sent it from its outbox after the first landed) finds its id here and gets the same answer, so a clip
// lands once however often it is sent: an append to a note or a task as much as a new note or task. A save that failed
// leaves no record, and may be sent again under the same id. The hooks write it, nothing else: no API rule is open. Kept a
// week (the hook prunes), far longer than a re-send waits.
migrate((app) => {
  app.save(new Collection({
    name: "clip_saves", type: "base", listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "result", type: "json", required: true, maxSize: 20000 },
      { name: "created", type: "autodate", onCreate: true },
    ],
  }));
}, (app) => {
  app.delete(app.findCollectionByNameOrId("clip_saves"));
});
