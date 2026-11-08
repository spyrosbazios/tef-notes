/// <reference path="../pb_data/types.d.ts" />
// GET /api/tefnotes/link-preview?url=<http(s) URL>: the title, description, site, picture and icon of a page, for the
// editors' link cards and the lists' thumbnails. Fetched here because a browser or WebView can't read another site's
// HTML (CORS), and cached in `link_previews` (pb_migrations/1792500001). The fetch, its SSRF guard and the parser are
// in lib/link-preview.js: a handler runs in a VM of its own and sees none of this file's top-level scope, so it
// `require`s the lib instead (constants included).
//
// The page's picture is fetched once more through the same guard and kept on the record (`picture`), so clients draw
// it at the server's thumb sizes (pb_migrations/1794200000_thumbs.js) and never load it from the other site.
//
// 200 always carries all six fields, empty when the page says nothing; 400 is a URL this server won't fetch; 502 the site
// didn't answer and nothing is cached (not saved: asked again next time).
// Nothing is signed in, like the rest: the tailnet is the gate, and it is why the guard in the lib exists.

routerAdd("GET", "/api/tefnotes/link-preview", (e) => {
  const lib = require(`${__hooks}/lib/link-preview.js`);
  const FIELDS = ["title", "description", "site", "image", "icon"];

  let url;
  try { url = lib.parseUrl(e.request.url.query().get("url") || "").href; } catch (err) {
    if (err instanceof lib.Blocked) throw new BadRequestError(err.message);
    throw err;
  }

  let rec = null;
  try { rec = e.app.findFirstRecordByFilter("link_previews", "url = {:url}", { url }); } catch (err) { /* none yet */ }
  const found = (r) => r.getString("title") !== "" || r.getString("image") !== "";
  const fresh = rec && Date.now() - rec.getInt("fetched") < (found(rec) ? lib.FOUND_TTL : lib.EMPTY_TTL);

  let out = rec && Object.fromEntries(FIELDS.map((f) => [f, rec.getString(f)]));
  /** The record's kept picture as `<record>/<file>`, or "". */
  const pictureOf = (r) => (r.getString("picture") ? `${r.id}/${encodeURIComponent(r.getString("picture"))}` : "");
  /** The page's picture into a temp file through the guard, as a file to keep; null when it is no picture we take. */
  const fetchPicture = (src, run, file) => {
    if (!src) return null;
    try {
      const got = lib.fetchPage(src, { lookup: lib.getent(run), get: lib.curlFile(run, file) });
      const type = got.type.split(";")[0].trim();
      if (got.status >= 400 || !/^image\/(jpeg|png|webp|gif)$/.test(type)) return null;
      const size = $os.stat(file).size();
      if (size === 0 || size >= lib.IMAGE_BYTES) return null;
      const f = $filesystem.fileFromPath(file);
      f.name = `picture.${type.slice(6).replace("jpeg", "jpg")}`;
      return f;
    } catch (err) { return null; }                       // blocked, or the site didn't answer: no picture, still a preview
  };
  if (!fresh) {
    const run = (name, ...args) => toString($os.exec(name, ...args).output());
    let page = null;
    let blocked = false;
    try { page = lib.previewOf(url, { lookup: lib.getent(run), get: lib.curl(run) }); } catch (err) { blocked = err instanceof lib.Blocked; }
    // the site didn't answer (down, slow, rate-limited) and there is nothing to fall back on: a 502, not cached, so the
    // editor asks again later instead of drawing an empty card for an hour
    if (!page && !out && !blocked) return e.json(502, { error: "The site didn't answer." });
    if (page || !out) {                                  // a failed refresh keeps the stale preview there is
      out = page || Object.fromEntries(FIELDS.map((f) => [f, ""]));
      const r = rec || new Record(e.app.findCollectionByNameOrId("link_previews"));
      r.set("url", url);
      for (const f of FIELDS) r.set(f, out[f]);
      r.set("fetched", Date.now());
      const file = `${$os.tempDir()}/tefnotes-preview-${$security.randomString(20)}`;
      try {
        if (page) r.set("picture", fetchPicture(out.image, run, file));   // null clears a stale one; a failed refresh keeps it
        try { e.app.save(r); rec = r; } catch (err) { /* a concurrent request saved the same URL first */ }
      } finally {
        try { $os.remove(file); } catch (_) { /* never written */ }
      }
    }
  }

  e.response.header().set("Cache-Control", "private, max-age=3600");
  return e.json(200, { url, ...out, picture: rec ? pictureOf(rec) : "" });
});

// Previews nobody asked for in a quarter: gone
cronAdd("link_previews_prune", "17 4 * * *", () => {
  const lib = require(`${__hooks}/lib/link-preview.js`);
  $app.db().newQuery("DELETE FROM link_previews WHERE fetched < {:t}").bind({ t: Date.now() - lib.KEEP_TTL }).execute();
});
