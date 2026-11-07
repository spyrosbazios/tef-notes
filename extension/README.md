# TEF Notes Clipper

<!-- reviewed: 2026-11-01 -->

A Chrome (Manifest V3) extension that saves the page you are on, a selection, a link or a picture to your
[TEF Notes](../README.md) notes. The server suggests which of your notes and open tasks it fits; you pick one (or a new
note), optionally add a note of your own, and only then is anything written.

## How it works

- **Toolbar button**: opens a popup for the current tab. The server's suggestions are listed, the best one
  emphasised and focused; one click, or Enter, saves there. "New note" is always an option.
- **Context menu**: "Save to TEF Notes" on a page, a selection, a link or a picture opens the same choice in a small
  window. It closes itself after a save: after 1.5 s, or 5 s when a summary you asked for had to be left out, so you
  can read why. Escape closes it at any time.
- **Suggest, then save**: the extension first sends the page's address, title, selection and text (and, for a
  picture, a small copy of it) to `POST /api/tefnotes/clip/suggest`, which writes nothing. Your pick goes to
  `POST /api/tefnotes/clip`. The request and response shapes are in [`../ARCHITECTURE.md`](../ARCHITECTURE.md) and
  `../packages/core/src/clip.ts`.
- **Optional note**: type your own words and the suggestions are re-ranked with them as context. Ctrl/Cmd+Enter
  saves to the top option.
- **Optional summary**: tick "Add a summary" and the server writes a short summary under the link or picture. It is
  off by default and remembered. A clip is saved whether or not the summary could be written; the popup says when it
  could not.
- **Pictures**: saved as an attachment of the note, downscaled as the phone does it. If the extension cannot fetch a
  picture itself, the server tries, and failing that the popup offers to ask for access to that one site.

## Requirements

- Chrome or a Chromium-based browser.
- A running TEF Notes server ([`../server/README.md`](../server/README.md)). The suggestions need the model keys set
  up there; without them the extension still saves, suggesting nothing.
- To build: [bun](https://bun.sh) and the whole repository cloned (the extension imports
  [`../packages/core`](../packages/core/README.md)).

## Development: load unpacked

```sh
cd extension
bun install
bun run build
```

In `chrome://extensions`, turn on Developer mode, choose Load unpacked, and select `extension/dist`. The options page
opens on install. After a change, rebuild and press the extension's reload button. An unpacked build does not
update itself.

| Script | Does |
|---|---|
| `bun run build` | Builds into `dist/` (popup, options page, service worker, manifest, icons) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | oxlint |
| `bun run pack <key> <out>` | Packs `dist/` into a signed CRX plus `update.xml` in `<out>`; needs `TEF_NOTES_URL` and a key (prints usage without arguments) |
| `bun run id [key]` | Prints the extension ID the signing key gives (default `../server/crx-key.pem`) |

## Options: the server address

The options page asks for your server's address (for example `https://notes.example.net:8443`) and then asks the
browser to allow access to that one origin. Nothing else is requested up front.

## Install from your server

Rather than loading unpacked, your server can build, sign and serve the extension, and Chrome installs and updates
it by policy.

1. **Create a signing key** once, and keep it: in `server/`, `openssl genrsa -out crx-key.pem 2048`, then
   `TEF_NOTES_CRX_KEY=./crx-key.pem` in `server/.env` ([`../server/README.md`](../server/README.md) has the details).
   The file is gitignored. The extension's ID is derived from it, so a lost or replaced key means a new ID and a new
   policy entry on every machine, and every installed copy is orphaned. Nothing backs it up for you. Never print or
   share it; `bun run id` gives the ID without it.
2. **Set `TEF_NOTES_URL`** to your server's public origin (the one your browsers use). The server image builds the
   extension with it as the manifest's `update_url` (`<TEF_NOTES_URL>/extension/update.xml`) and serves
   `<TEF_NOTES_URL>/extension/tefnotes.crx` and `update.xml`. Without a key the build still works and serves no
   extension.
3. **Deploy**: `docker compose up -d --build` in `server/`. The build log has one `crx:` line with the version and the
   extension ID packed, or says there is no key.
4. **Get the ID**: `cd extension && bun run id`.
5. **Add the policy** on each machine, as an administrator: a file `tefnotes.json` in the browser's managed-policy
   directory:

   ```json
   {"ExtensionInstallForcelist": ["<id>;<TEF_NOTES_URL>/extension/update.xml"]}
   ```

   On Linux the directory is `/etc/opt/chrome/policies/managed/` for Google Chrome and
   `/etc/chromium/policies/managed/` for Chromium (some Chromium derivatives read only the Chromium one).
   macOS and Windows keep policies elsewhere (a managed preferences profile, the registry), and Chrome there only
   force-installs from outside the Web Store on managed devices; see Google's `ExtensionInstallForcelist` documentation.
   `chrome://policy` shows whether the policy loaded.
6. **Restart the browser.** The options page opens on install: enter the server address and allow access.

### Releasing an update

Chrome installs an update only for a higher `version`, so a deploy of the same version changes nothing on your machines.
The version is the repository's git tag, read by `../scripts/version.sh` ([`../CONTRIBUTING.md`](../CONTRIBUTING.md#versioning));
set `TEF_NOTES_VERSION` to build another. Tag a release, then deploy the server as above.
`curl -s <TEF_NOTES_URL>/extension/update.xml` shows the version being offered; Chrome polls every few hours, and
`chrome://extensions` -> Update checks now. If you replace the key at the same path, build with
`docker compose build --no-cache`, because a build secret is not part of the build cache key.

## Permissions and privacy

- `activeTab` and `scripting`: read the current page's text, only when you click the button or the menu item.
- `storage`: the server address and the summary box, in `chrome.storage.sync`, and the context menu's page passed
  to its window, in session storage.
- `contextMenus`: the "Save to TEF Notes" item.
- Optional host access (`https://*/*`, `http://*/*`): requested at runtime for your server's origin only, and for one
  site at a time if you allow reading a picture it refuses to share. The manifest grants no host access by default.

The extension talks to your server and, to fetch a picture, the site that picture is on. It has no analytics and no
sign-in; the server is the only place a clip is sent, and it has no authentication either, so keep it on a private
network.
