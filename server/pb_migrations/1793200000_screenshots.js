/// <reference path="../pb_data/types.d.ts" />
// Screenshots: the phone uploads each new one and pb_hooks/screenshots.pb.js groups consecutive shots into a capture,
// an ordinary note marked by its path (`notes/YYYYMMDD-shots-HHMMSS.md`, packages/core/src/screenshots.ts). One row per
// shot here, beside its photo in `attachments`:
//   note        the capture (cascade: a capture deleted takes its rows; its photos go with it, notes.pb.js)
//   attachment  the photo's name under that note (`attachments.name`)
//   device      the phone that sent it, with mediaId (the phone's own id for the picture) the key of a retry: unique
//   takenAt     when the screenshot was taken, unix ms
//   app         the app it was taken in (a package name, optional): the first hint that two shots belong together
//   ocr         the text the phone read from the image
//   type        what JEV decided it is (`other` when it could not)
//   fields      what patterns found in the text: amounts, IBANs, emails, phones, links, Wi-Fi
//   position    its place in the capture
//   reviewed    the owner has looked it through
//   sensitive   a code or a card number: kept here, out of the note's text, never sent to JEV
// Open rules like the rest (1792400000_open.js: the private network is the gate), except what only the server writes:
// a client reads rows, ticks `reviewed` and may correct `type`; it makes and deletes none (a shot is added by the upload
// route and goes with its capture), and sets no other column.
const TYPES = ["paper_note", "receipt", "chat", "document", "product", "contact", "app_ui", "diy_part", "other"];
const SERVER_OWNED = ["note", "attachment", "device", "mediaId", "takenAt", "app", "ocr", "fields", "position", "sensitive"];

migrate((app) => {
  const notes = app.findCollectionByNameOrId("notes");
  const t = (name, o = {}) => ({ name, type: "text", ...o });
  app.save(new Collection({
    name: "screenshots", type: "base",
    listRule: "", viewRule: "", createRule: null, deleteRule: null,
    updateRule: SERVER_OWNED.map((f) => `@request.body.${f}:isset = false`).join(" && "),
    fields: [
      { name: "note", type: "relation", collectionId: notes.id, maxSelect: 1, required: true, cascadeDelete: true },
      t("attachment", { required: true, max: 200 }), t("device", { required: true, max: 100 }), t("mediaId", { required: true, max: 200 }),
      { name: "takenAt", type: "number", onlyInt: true, required: true, min: 1 },
      t("app", { max: 200 }), t("ocr", { max: 100000 }),
      { name: "type", type: "select", maxSelect: 1, required: true, values: TYPES },
      { name: "fields", type: "json", maxSize: 100000 },
      { name: "position", type: "number", onlyInt: true, min: 0 },
      { name: "reviewed", type: "bool" }, { name: "sensitive", type: "bool" },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_screenshots_device_media ON screenshots (device, mediaId)",
      "CREATE INDEX idx_screenshots_note ON screenshots (note, position)",
      "CREATE INDEX idx_screenshots_taken ON screenshots (takenAt)",
    ],
  }));
}, (app) => {
  app.delete(app.findCollectionByNameOrId("screenshots"));
});
