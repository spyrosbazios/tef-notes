/// <reference path="../pb_data/types.d.ts" />
// chats gets `rev`, the compare-and-swap of pb_hooks/rev.pb.js (1792600000_chats.js made the record with none: the agent
// PATCHed the whole history over it from several writers, and the last save won). The agent is now the one writer of a
// chat's messages (server/agent/src/chats.ts) and every save names the rev it was based on; a stale one is a 409. A chat
// made before this reads as rev 0 (an empty number, which a field that isn't required allows) and its first save makes it
// 1, so no record is rewritten here.
migrate((app) => {
  const c = app.findCollectionByNameOrId("chats");
  c.fields.add(new NumberField({ name: "rev", onlyInt: true, min: 1 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("chats");
  c.fields.removeByName("rev");
  app.save(c);
});
