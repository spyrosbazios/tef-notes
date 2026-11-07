/// <reference path="../pb_data/types.d.ts" />
// Tile pictures come in two sizes, both drawn by PocketBase's own thumbnailer on first ask and kept on disk: a tiny one
// a tile shows blurred at once, and the one that sharpens over it. Sizes: `THUMB_SIZES` in packages/core/src/pocketbase.ts.
// A link's picture is fetched once by the preview route (the same SSRF guard as its page) and kept on its
// `link_previews` record, so it gets the same two sizes and is never loaded from the other site by a client;
// viewing a record (and so its file) is open like the rest, listing stays closed.
const THUMBS = ["32x32f", "640x640f"];
const IMAGES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

migrate((app) => {
  const a = app.findCollectionByNameOrId("attachments");
  a.fields.getByName("file").thumbs = THUMBS;
  app.save(a);
  const l = app.findCollectionByNameOrId("link_previews");
  l.fields.add(new FileField({ name: "picture", maxSelect: 1, maxSize: 20 * 1024 * 1024, mimeTypes: IMAGES, thumbs: THUMBS }));
  l.viewRule = "";
  app.save(l);
  // Previews cached before this have no copy of their picture: asked again on their next view (one-shot, data only)
  app.db().newQuery("UPDATE link_previews SET fetched = 0 WHERE image != ''").execute();
}, (app) => {
  const a = app.findCollectionByNameOrId("attachments");
  a.fields.getByName("file").thumbs = [];
  app.save(a);
  const l = app.findCollectionByNameOrId("link_previews");
  l.fields.removeByName("picture");
  l.viewRule = null;
  app.save(l);
});
