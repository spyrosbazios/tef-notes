/// <reference path="../pb_data/types.d.ts" />
// notes: one record per note, plus agent/memory.md, keyed by `path`. `text` is the whole markdown file and the
// only thing edited; title, day, flags and tags are copies of its frontmatter the clients write alongside, so
// lists and filters need no parsing. `rev` is the version the phones merge against (pb_hooks/notes.pb.js).
// attachments: a photo per record, under the note id the body's `../attachments/<note>/<name>` points at.
// One owner: no sign-up, every rule is "signed in".
migrate((app) => {
  const AUTH = "@request.auth.id != ''";
  const rules = { listRule: AUTH, viewRule: AUTH, createRule: AUTH, updateRule: AUTH, deleteRule: AUTH };
  const stamps = [{ name: "created", type: "autodate", onCreate: true }, { name: "updated", type: "autodate", onCreate: true, onUpdate: true }];
  const t = (name, o = {}) => ({ name, type: "text", ...o });
  const b = (name) => ({ name, type: "bool" });

  app.save(new Collection({
    name: "notes", type: "base", ...rules,
    fields: [
      t("path", { required: true, pattern: "^(notes/[^/]+\\.md|agent/memory\\.md)$" }),
      t("text", { max: 1000000 }),
      { name: "rev", type: "number", onlyInt: true, min: 1 },
      t("title", { max: 500 }), t("day", { pattern: "^(\\d{4}-\\d{2}-\\d{2})?$" }), b("pinned"), b("sticky"),
      { name: "color", type: "select", maxSelect: 1, values: ["yellow", "pink", "blue", "green", "purple", "gray"] },
      { name: "tags", type: "json", maxSize: 10000 },
      ...stamps,
    ],
    indexes: ["CREATE UNIQUE INDEX idx_notes_path ON notes (path)"],
  }));

  app.save(new Collection({
    name: "attachments", type: "base", ...rules, updateRule: null,      // a photo never changes: replaced means deleted and added
    fields: [
      t("note", { required: true, pattern: "^[^/]+$" }), t("name", { required: true, pattern: "^[^/]+$" }),
      { name: "file", type: "file", required: true, maxSelect: 1, maxSize: 15 * 1024 * 1024, mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"], protected: true },
      ...stamps,
    ],
    indexes: ["CREATE UNIQUE INDEX idx_attachments_note_name ON attachments (note, name)"],
  }));

  const users = app.findCollectionByNameOrId("users");
  users.createRule = null;                                                // the owner's account is made by hand, in the dashboard
  app.save(users);
}, (app) => {
  for (const n of ["attachments", "notes"]) app.delete(app.findCollectionByNameOrId(n));
  const users = app.findCollectionByNameOrId("users");
  users.createRule = "";
  app.save(users);
});
