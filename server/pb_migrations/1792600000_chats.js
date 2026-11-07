/// <reference path="../pb_data/types.d.ts" />
// The chat agent moved from the phone to the server (agent/, the sidecar):
//   chats          one record per chat. A client creates it (empty) before the first message and reads it back; the
//                  sidecar writes `messages` (the AI SDK's UIMessage[], as useChat holds them), `title` and `model`
//                  (the model id) as the reply streams and when it ends. Open rules, like notes
//                  (1792400000_open.js): the tailnet is the gate.
//   notes.tainted  the sidecar's mark on a note it wrote with web text in view: reading it back later counts as reading
//                  the web, so the next write asks first. Set in the write itself, never cleared; clients never send it.
migrate((app) => {
  app.save(new Collection({
    name: "chats", type: "base", listRule: "", viewRule: "", createRule: "", updateRule: "", deleteRule: "",
    fields: [
      { name: "title", type: "text", max: 500 },
      { name: "messages", type: "json", maxSize: 20000000 },
      { name: "model", type: "text", max: 200 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_chats_updated ON chats (updated)"],
  }));
  const notes = app.findCollectionByNameOrId("notes");
  notes.fields.add(new BoolField({ name: "tainted" }));
  app.save(notes);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("chats"));
  const notes = app.findCollectionByNameOrId("notes");
  notes.fields.removeByName("tainted");
  app.save(notes);
});
