/// <reference path="../pb_data/types.d.ts" />
// link_previews: the cache behind GET /api/tefnotes/link-preview (pb_hooks/link-preview.pb.js). One record per URL:
// what the page said about itself, fetched server-side because a browser or WebView cannot read another site's HTML.
// `fetched` (ms) is when; an empty record is a page with nothing to preview, kept so a dead site isn't asked again at
// once. No rules: only the route reads or writes it, never a client.
migrate((app) => {
  const t = (name, max) => ({ name, type: "text", max });
  app.save(new Collection({
    name: "link_previews", type: "base",
    fields: [
      { name: "url", type: "text", required: true, max: 2048 },
      t("title", 300), t("description", 600), t("site", 120), t("image", 2048), t("icon", 2048),
      { name: "fetched", type: "number", onlyInt: true, required: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_link_previews_url ON link_previews (url)", "CREATE INDEX idx_link_previews_fetched ON link_previews (fetched)"],
  }));
}, (app) => {
  app.delete(app.findCollectionByNameOrId("link_previews"));
});
