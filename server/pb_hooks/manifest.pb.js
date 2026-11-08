/// <reference path="../pb_data/types.d.ts" />
// The web manifest, in the owner's theme: the built one (pb_public, beside this hooks directory in the image: the Dockerfile's
// layout) with `background_color` and `theme_color` set to the chosen theme's ground, so Android's splash of the installed
// app follows the theme. Chrome fetches the manifest again a day after each launch and remints the app when these changed,
// at this address only: the route takes the file's place rather than adding one. The theme is the preferences record's
// (packages/core/src/prefs.ts, the `prefs` collection); the colours per theme are the build's `manifest-colors.json`. Missing
// either, the manifest goes out as built. The logic: lib/manifest.js (tested).
//
// GET /manifest.webmanifest -> 200 application/manifest+json; 404 when the build has none.
//
// A handler runs in its own VM and sees nothing of this file's top level: it requires what it uses.
routerAdd("GET", "/manifest.webmanifest", (e) => {
  const lib = require(`${__hooks}/lib/manifest.js`);
  const pub = `${__hooks}/../pb_public`;
  const read = (name) => JSON.parse(toString($os.readFile(`${pub}/${name}`)));

  let manifest;
  try { manifest = read("manifest.webmanifest"); } catch (_) { return e.json(404, { error: "No manifest." }); }
  let colors = null;
  try { colors = read("manifest-colors.json"); } catch (_) { /* a build without it: as built */ }
  let prefs = null;
  try { prefs = JSON.parse(e.app.findFirstRecordByData("prefs", "key", "owner").getString("data") || "null"); } catch (_) { /* none saved yet */ }

  e.response.header().set("Cache-Control", "no-cache");
  return e.blob(200, "application/manifest+json; charset=utf-8", JSON.stringify(lib.themed(manifest, colors, prefs)));
});
