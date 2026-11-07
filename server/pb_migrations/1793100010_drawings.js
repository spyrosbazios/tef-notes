/// <reference path="../pb_data/types.d.ts" />
// An attachment can be a drawing as well as a photo or a PDF: the web app's Excalidraw scene, a JSON file named
// `<name>.excalidraw`, kept beside a PNG preview of it (already allowed). PocketBase checks the type it sniffs from the
// bytes, and plain JSON is read as `application/json` or as text, so the field takes those. Size stays as the PDF
// migration left it (a scene with embedded images can be a few MB).
const IMAGES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const DRAWING = ["application/json", "text/plain", "text/plain; charset=utf-8"];
const MB = 1024 * 1024;

/** The attachments' file field with these mime types and size limit. */
function limit(app, mimeTypes, maxSize) {
  const c = app.findCollectionByNameOrId("attachments");
  const file = c.fields.getByName("file");
  file.mimeTypes = mimeTypes;
  file.maxSize = maxSize;
  app.save(c);
}

migrate(
  (app) => limit(app, [...IMAGES, "application/pdf", ...DRAWING], 25 * MB),
  (app) => limit(app, [...IMAGES, "application/pdf"], 25 * MB),
);
