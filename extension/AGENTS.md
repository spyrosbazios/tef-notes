# extension — Chrome clipper

Manifest V3 extension, TypeScript, built by Vite into `dist/` (gitignored). Sends the current page, or a picture on it,
to the server, which suggests the notes and open tasks it fits (JEV); the user picks, optionally adds a note, and only then is it written.
The phone's Share screen calls the same routes: the shapes are one file, `packages/core/src/clip.ts`, imported by both.
Root `AGENTS.md` has the server and the note format; this file only what is the extension's. How to build, install and
release it is in `README.md`, not repeated here.

<!-- reviewed: 2026-11-06 -->

## Contract

Two steps; the server side is `server/pb_hooks/clip.pb.js`, `src/clip.ts` the extension's only caller (the phone's is
`mobile/src/store/clip.ts`). Shapes: `packages/core/src/clip.ts`. Errors are `{error}`. A target is `{kind: "new", title?}` (`title` the owner's own for the new note, at most 200 chars; else the server titles it),
`{kind: "note", path}` or `{kind: "task", id}`, both ways; on save also `{kind: "newtask", title?}` (a new task, titled the
same way; never suggested, always offered last).

1. `POST {server}/api/tefnotes/clip/suggest`, JSON `{url?, title, selection?, text?, note?, image?: {src, alt?, caption?,
   look}}` (`url` is absent only for what the phone shares as text or a photo, which then carries a selection or a picture; `text` is `document.body.innerText`, capped at 50000 chars; `note` the user's words, at most 2000, context
   for where it goes; `image` the picture the menu was opened on: its address, its alt text or title, its figure's
   caption, and `look`, a base64 JPEG of it, long edge 768, padded to 280 a side, that JEV sees) answers
   `200 {suggestions: [{kind: "note", path, title, p} | {kind: "task", id, title, p}], pick, line?}` and writes nothing.
   JEV chooses among the pinned and 60 newest notes and the 40 most recently touched open tasks (`TASKS` in
   `lib/clip.js`). `suggestions`: at most 4, best first, each at JEV probability `p` >= 0.05 (below is noise among 100+
   options; `FLOOR`). `pick`: the top option overall, a suggestion's target or `{kind: "new"}` when JEV rates a new note
   above every other option. `line`: the page's own passage JEV chose as what the page is. Without a key or when JEV fails: no suggestions,
   `pick` is new. A picture TypeSafe refuses (its image input is opt-in and early) is asked about again by its words.
   Typing a note asks again (after a 0.9 s pause, or on leaving the box).
2. `POST {server}/api/tefnotes/clip`, multipart: `@jsonPayload` = `{url?, title, selection?, line?, note?, image?: {src,
   alt?, caption?}, target, summary?: true, text?}` (`target` as above, `line` passed back from step 1; `summary` only
   when the user ticked "Add a summary", and `text` the page's text then, the same 50000 chars as in step 1) and, with `image` and a note, a new
   note or a new task as target, the `file` part: the JPEG to store (long edge 1600, quality 0.82, as the phone's `photos.ts`;
   an existing task takes none: `sendsFile` in core). Answers `200 {kind: "note", path, title, action: "created" | "appended", summary?}` or `{kind: "task", id, title,
   action: "created" | "appended", note?, summary?}`; no JEV. The body: `![caption or alt](../attachments/<note-id>/<YYYYMMDD-HHMMSS>.jpg)`,
   the page link, the summary (below), the note written up by the server's model (tidied, its language kept, nothing added; as typed
   when that fails), `line` (left out when there is a summary), the selection.
   The summary is the one thing the model writes of its own, and only when asked: a blockquote under a bold "Summary"
   label, 3 to 5 sentences or bullets in the content's language, nothing the content does not say. A page's is written from
   `text`; for a link that came with none (the phone's) the server fetches the page through the link-preview guard
   (`lib/link-preview.js` `textOf`, never `$http.send`). A picture's only from the words it came with (caption, alt text,
   text shared with it: the model cannot see it); the page it was on is context. `summary` in the answer: `"added"`;
   `"skipped"` (nothing to write it from: a picture with no words, a page with no text); `"failed"` (no model key, the
   page could not be fetched, the model failed: a `clip:` log line says why). The clip is saved in every case, and the
   clients say so when it is not `"added"` (`summaryNotice` in core). No `summary` in the answer: none was asked for. Into a task the same text is added to its `notes` after a blank line, in a rev-bumping
   transaction as a note's append is; a task has no attachments (`attachments.note` relates to notes only), so a picture
   there is an image line `![<caption or alt>](<src>)` (the phone and the web draw it; plain text when `src` is no http address) and its bytes are not kept. `404` if the target no longer
   exists, `413` if a task's notes would overflow, `400` for a malformed target or an `image` without its `file` (or the
   reverse; for an existing task, any `file`).
   A new task (`created`): titled by the owner's `title`, else as a new note would be; its `notes` the same text without the
   picture; the owner's tags; rev 1, after every other task. With a picture, a new note holding the whole clip (picture first)
   is made too, the task linked `about` it (`links`, `packages/core/src/record-links.ts`), and `note` in the answer is its
   path. Note, task and link are written in one transaction.
   The save also takes `tags?: [name]`, the owner's: a new note or task carries them; a note or task appended to gains the ones it
   lacks (case and tonos folded), in the same rev-bumping write.
2b. `POST {server}/api/tefnotes/clip/tags`, JSON as step 1 (the picture unused), answers `200 {tags: [{name, p}], picked}`
   and writes nothing: every defined tag scored by JEV (one yes/no each, as the auto-tagger asks), best first; `picked` every
   one at or above 0.85, else the best at or above 0.5 (`tagPick` in `lib/clip.js`). No key, no definitions or a JEV
   failure: every tag at 0, none picked. Asked beside step 1, so the chips show as soon as JEV answers; asked again with a
   typed note until the owner changes the chips. Shape: `ClipTags` in core.
3. `GET {server}/api/tefnotes/clip/image?url=` the picture's bytes, fetched by the server through the link-preview SSRF
   guard, when the extension can't fetch it itself: public pictures only. `400` for an address it won't fetch, `502`
   when there is no picture there. Some sites refuse it (Wikimedia rejects its user agent); the extension's own fetch
   is tried first.

No key and no sign-in anywhere: the private network the server sits on is the gate.

## Where facts live

| Path | Holds |
|---|---|
| `src/clip.ts` | The requests (bodies from `packages/core/src/clip.ts`), reading the page and the picture's words (`chrome.scripting`), the errors |
| `src/picture.ts` | The picture's bytes (the extension's own fetch, else the server's, else asking for the site) and the two JPEGs made on a canvas: the one stored, the one JEV sees |
| `src/settings.ts` | The server address and the "Add a summary" box (`chrome.storage.sync`), and the runtime host permission for that origin |
| `src/options.ts` | The options page: takes the server address and requests host access to its origin |
| `src/popup.ts` | The one choice UI, in sections (the page's card; Tags: picked chips, a tap removes, likely ones offered at 30%+, any other defined tag from a list; Details: title, note, summary; Save to: the choices): a picture read and shown first (its JPEG to store and the copy JEV sees, `src/picture.ts`), then as a page: suggest, the options (the pick emphasised and focused, other notes with an append icon, tasks with a lucide `ListTodo`, "New note", then "New task" with `ClipboardPlus`; labels and order from `choices` in core), the optional title (used only for a new note or task), the optional note (re-ranks; Ctrl/Cmd+Enter saves to the top option, Enter is a new line), the "Add a summary" box (off until ticked, then as left: `getSummary`), one click or Enter saves, the result (and a line when the summary was left out). The toolbar popup (current tab) and the context menu's window (`?handoff=`) |
| `src/background.ts` | The "Save to TEF Notes" context-menu item (page, selection, link, image): reads the page, hands it over, opens `popup.html` in a small window |
| `src/handoff.ts` | The context menu's page passed to that window through `chrome.storage.session`, taken once |
| `src/icons.ts` | The lucide icons the popup and options page draw, as DOM nodes (no framework here), and the brand mark from `@/core/brand` |
| `src/env.d.ts` | Ambient declarations for the palette CSS (`virtual:tefnotes-theme.css`) and `*.css` imports |
| `vite.config.ts` | Manifest (`version` from `scripts/version.sh`; with `update_url` when `TEF_NOTES_URL` is set), icon PNGs (the brand mark, `packages/core/src/brand.ts`, in the brand colour), the palette's CSS variables (`packages/core/vite.ts`) |
| `scripts/crx.ts` | The signed CRX3 and `update.xml` the server image serves at `/extension/`; the extension ID from the key |
| `server/docker-compose.yml` | `TEF_NOTES_URL` (the one place the public origin is written) and the key as a build secret |

## Footguns

- Colours come from `packages/core/src/theme.ts`, as `--tf-*` variables generated by `packages/core/vite.ts`; `src/ui.css` and the
  sources name none. The manifest and icons are generated too: nothing to hand-edit in `dist/`.
- Host access is `optional_host_permissions`, requested for the one configured origin from the options page's submit
  (a user gesture is required: nothing may be awaited before `chrome.permissions.request`). Never widen it to the manifest's
  `host_permissions`. A picture's site is asked for the same way, one origin at a time, only when neither the extension's
  own fetch (CORS) nor the server's (public pictures) got the bytes: the window's "Allow reading pictures from <host>"
  button. Granted, the extension's fetch carries the browser's session for that site.
- A canvas can't read a picture the page drew from another origin (tainted), so the bytes are fetched again, not taken
  from the page. Transparency becomes the palette's light `fg`: a JPEG has none.
- The context menu opens a `chrome.windows.create` popup window, not `chrome.action.openPopup()`: that rejects without a
  focused window showing the toolbar. The window closes itself after a save: `CLOSE_MS` (1.5 s), or `CLOSE_NOTICE_MS`
  (5 s) when the result carries a line about a summary left out, so it can be read; also on Escape. The toolbar popup
  closes the same way: left open, Chrome may not repaint it once its sections collapse, and it looks frozen. While the
  save runs, the option clicked spins.
- Never give that window `left`/`top`. Chrome rejects bounds less than half on a screen ("Invalid value for bounds"),
  and the clicked window's reported bounds can't be trusted on every platform (seen on Wayland): a position computed
  from them can land off every screen, and the rejection went unseen in the service worker, so no window, no error. A
  window refused anyway opens as a tab; when nothing opens, the toolbar icon shows "!" on that tab with the reason in its
  tooltip, and `chrome://extensions` -> Errors has it.
- The page text is read with `activeTab` + `scripting`; pages Chrome won't script (PDF viewer, web store) are still sent
  with url and title only.
- `server/crx-key.pem` (gitignored) is the extension's identity: its ID is the hash of the public key. Lose or replace it
  and every installed copy is orphaned: the new ID needs a new policy entry. Never read or print it; `bun run id` gives
  the ID without it. It sits in `server/` because Compose refuses a build secret from outside the build context.
- Chrome installs an update only for a higher `version`: a deploy of the same version changes nothing for installed copies. The
  version is the repo's git tag (`scripts/version.sh`, `TEF_NOTES_VERSION` overrides); `package.json` holds none.
- A build secret is not part of the build cache key; `CRX_KEY_FILE` (its path) is. A key replaced at the same path is
  only picked up by `docker compose build --no-cache`.
- With no key, `/extension/update.xml` is PocketBase's SPA fallback (`index.html`, 200): Chrome finds no update there.
