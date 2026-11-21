/// <reference path="../pb_data/types.d.ts" />
// chat_files: a photo or PDF the owner attached to a chat message, one per record, under its chat (deleted with it). The
// message's file part points at it (packages/core/src/assistant.ts `chatFileUrl`) instead of carrying its bytes as a data
// URL inside `chats.messages`, whose 20 MB cap two 8 MB PDFs used to fill, after which every save of that chat failed. The
// agent stores them as the message arrives (server/agent/src/chat-files.ts). Chats saved before this keep their files
// inline and are read as they are. Open rules, like chats (1792600000_chats.js); a file never changes.
migrate((app) => {
  const chats = app.findCollectionByNameOrId("chats");
  app.save(new Collection({
    name: "chat_files", type: "base", listRule: "", viewRule: "", createRule: "", updateRule: null, deleteRule: "",
    fields: [
      { name: "chat", type: "relation", collectionId: chats.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "name", type: "text", max: 255 },
      { name: "file", type: "file", required: true, maxSelect: 1, maxSize: 8 * 1024 * 1024, mimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"] },
      { name: "created", type: "autodate", onCreate: true },
    ],
    indexes: ["CREATE INDEX idx_chat_files_chat ON chat_files (chat)"],
  }));
}, (app) => {
  app.delete(app.findCollectionByNameOrId("chat_files"));
});
