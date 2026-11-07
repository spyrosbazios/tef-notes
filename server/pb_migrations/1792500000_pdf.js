/// <reference path="../pb_data/types.d.ts" />
// An attachment can be a PDF as well as a photo: the file field takes application/pdf, and its size limit leaves
// room for one (a photo is downscaled to a few hundred KB by the clients; a PDF goes up as it is).
const IMAGES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MB = 1024 * 1024;

/** The attachments' file field with these mime types and size limit. */
function limit(app, mimeTypes, maxSize) {
  const c = app.findCollectionByNameOrId("attachments");
  const file = c.fields.getByName("file");
  file.mimeTypes = mimeTypes;
  file.maxSize = maxSize;
  app.save(c);
}

migrate((app) => limit(app, [...IMAGES, "application/pdf"], 25 * MB), (app) => limit(app, IMAGES, 15 * MB));
