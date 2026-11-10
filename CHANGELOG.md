# Changelog

All notable changes to TEF Notes. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
version is one semver number for the whole repository, set by the git tag (see [CONTRIBUTING.md](CONTRIBUTING.md#versioning)).

## 0.9.0 - 2026-11-10

### Added

- Web: a bar over selected words in a note (bold, italic, strikethrough, code, link, text style), and its AI button asks
  about the selection in place. On a phone it is the assistant's button alone; the keyboard bar has the format tools.
- Web: a note shows how far it's scrolled, an accent bar under its header.

- CLI: `search` (words and meaning, over the agent's new `GET /agent/search`), `set` and `drop` for tasks, `tag` to
  define a tag, and `--tag` / `--notes` on `add`. With `TEF_NOTES_AGENT=1` every write is marked `tainted`.
- `skills/tefnotes`: a skill that drives the CLI, for Claude Code, Codex and other coding agents.

### Changed

- Places are for tasks only: a note no longer has a `where`.
- Web: every format tool fits in the note bar when it is wide; colour swatches wrap.

### Fixed

- Web: a link to another note opens on a plain click.
- Web: the selection bar stays on screen when the selection is taller than the window.
- Web: toolbar icons at their button's size on desktop.
- Web: the update toast reloads on a first visit's page too, and Later's toast comes back at the next check.

### Removed

- The MCP endpoint (`/agent/mcp`, `TEF_NOTES_MCP`). Coding agents use the CLI through the `tefnotes` skill instead.

## 0.8.0 - 2026-11-09

### Added

- Desktop sidebar: it folds to its icons (`[` or its last button), its width on a spring.

### Changed

- Preferences: the phone and the desktop each keep their own start screen and Home list (Settings → Layout shows one card
  per layout, this screen's first). The desktop sidebar's screens (Inbox, Today, Upcoming, Logbook, Notes) can each be
  hidden in Settings → Layout; Notes no longer follows the phone's tabs.
  A device sends only the preferences it changed, so two devices no longer undo each other's, and a change reaches the
  others at once over the live feed. "Add a summary" on a shared link is a preference too. The `prefs` record moves to its
  new shape on start (`1794600000_prefs_layouts.js`).
- Place search uses OpenStreetMap (Photon, Nominatim and its tiles) instead of Google Maps: no key and no billing account.
  The map card is drawn from OSM's tiles in your theme; Directions and Open in Maps still open Google Maps.

### Removed

- The `maps` key and `TEF_NOTES_KEY_MAPS`. A place saved with a Google place id keeps its name, address and position.

## 0.7.0 - 2026-11-09

### Added

- A note's Where: one place per note, kept in its frontmatter (`where:`). On the web app a "place" button beside the tags
  searches Google Maps as you type (or keeps a name as typed); the note then shows a card under its title with the place's
  map in your theme, its address, Directions and Open in Maps (on a phone, the Maps app). Note tiles and the assistant's
  cards show the place's name.
- Tasks hold a place too (`where`, a new field): a Where row on the task's card with the same picker and map card, and
  the place's name on task rows and the assistant's task cards.
- Assistant: `find_place` searches Google Maps and `set_place` sets or clears a note's or a task's place (also over MCP).
- Server: a `maps` key (Google Maps Platform: Places API (New) and Maps Static API), `TEF_NOTES_KEY_MAPS`; without it a
  place is a name, with no search or map.
- Assistant: `list_tagged` lists notes and tasks by several tags (any or all, accents folded) in one call;
  `create_lens` saves a lens (confirmed, its tags checked first); `show_tasks` lays tasks on a timeline by day and
  `show_notes` shows notes as a gallery of Home's tiles.
- Palette: typing a lens's name switches to it, "no lens" turns it off; a previewed note's body is rendered Markdown.

### Changed

- Home: the planner's hovered day pops up magnified like a dock, a later day hovered on Today switches Upcoming, and the
  task box beside it shows the day (its tooltip is gone).
- Notes header: the tag filter's tags are removable badges beside the count.
- PWA: rows reorder by long press and drag; the touch grip is gone.
- Assistant: `list_notes` loses its tag filter (`list_tagged` replaces it); `update_task`'s `addNotes` links notes, and
  subtasks stay its checklist; `set_place`'s confirm card shows the place; home and work are set by their address.

### Fixed

- Form dialog: the lens form's colour row scrolls instead of widening the dialog.
- Where card: fits its own width under a task's Where label.
- Phone: the Ask tab is a history step, so back leaves it and a note or task picked in the chat shows.

## 0.6.0 - 2026-11-09

### Added

- Web: when a new chat starts is a setting (every open, after leaving the app, 30 minutes away, never), default after
  leaving the app.
- Phone: the lens form is a bottom sheet with labelled fields and one scrolling colour row; the colour picker folds to one
  row. One form sheet for the forms that save (lens, New task): the title and buttons stay put, only the fields scroll.
- Voice input can be turned off: `TEF_NOTES_STT=` (empty) in `.env` hides the mic and answers the routes with 404; the
  self-host skill's `verify.sh` probes it.
- Site: a Voice tile, a Set up once tile (preferences shared by every device) and the speech container under the hood;
  the feature tiles play their hover once scrolled into view on a phone, the themes scroll sideways there, and the
  closer peeks read at phone width.

### Changed

- Voice input: Parakeet TDT_CTC 110M replaces TDT 0.6B v2, about 2.5x faster at a third of the memory (~650 MB loaded);
  the model warms up as it loads, so the first clip is as fast as the rest.
- Phone: the tab bar floats over the page as liquid glass, hugging its tabs; the assistant's button and the PDF page
  counter are the same glass; the format tools ride on top of the keyboard in one scrolling row; the task lists slide as
  panels; Home's lens picker shows "All" and a chevron, so it reads as a control.
- Launch in the chosen theme: an inline boot layer paints the stored theme before any script, and the server serves the
  manifest in the owner's theme so Android's splash follows it.
- Web settings: Server & sync folded into Maintenance; a section's title is read out on the phone only.
- Site: the mocks match the app (the glass tab bar, the composer with its attach, model, mic and send, the mic in the
  note header and search, search results as tiles, no tag buttons in Home's heads), the copy says eighteen accents, the
  lens that is on follows you to every device, and the install commands are the README's.
- Docs: voice input's deployment and use (memory, the model's download, the secure context the mic needs, turning it
  off, checks and troubleshooting) in the server README, the self-host skill, the architecture and security notes.

### Fixed

- Closing a task opened from a note's linked tasks returns to the note, not to the task's list.
- Masonry: no tiles until the columns are measured, so they no longer glide from one column into two on arrival.
- Phone: a task's long-press menu opens beside the row, not top-left; the notes header stays at the top of its scroller,
  so the bulk bar is in view after a long press far down; the tab bar's capsule no longer shrinks to a circle as the
  labels swap, and the bar no longer winks on a page change.
- Voice input: a worker that dies loading fails the request instead of hanging it.

## 0.5.0 - 2026-11-08

### Added

- Web: route transitions. Switching tabs or screens crossfades the page (quick on a phone), a note slides up over the screen on a phone and back down on Back, and a note opened from its tile grows out of it and shrinks back into it.
- Web (phone): the search drawer slides down from the header as a sheet.
- Web: pictures and viewers. The lightbox is a carousel (swipe on a phone, arrow keys and buttons on a laptop) that grows out of the picture tapped, with zoom where the pointer is on a laptop and a rolling counter; the reader view shows how far down the article you are; the PDF viewer and the drawing editor fade in over a skeleton.
- Web: the Planned heatmap shows one tooltip that glides from day to day. Empty lists enter calmly; the task tabs' counts and the heatmap's total roll when they change; the checklist, the saved chats and the tags animate as they come and go; the When picker's options share one gliding highlight and the update toast's Reload says "Reloading…".

- Voice input: Parakeet speech to text on the server (its own `stt` container), a mic wherever text is typed, and how long the model stays loaded in Settings.
- Preferences live on the server and are shared by every device: theme and accent (18 accents), notes layout, assistant settings, the lens that is on, the phone's tab order, hidden tabs and label mode (active, every, none), and the screen the app opens on; tabs are dragged into order in Settings → Layout, Home and Tasks open on the list each starts on, and an optional Notes tab gives the notes a page of their own.
- Assistant input: the model and effort pill sits inside the field; photos and PDFs can be attached (PDFs read as text on the server; an attachment taints the turn).
- Settings: a Maintenance section with the app's version and build time and a reload that fetches the latest build; Import and Export as one section; the tag dialog fits a phone, tags searchable and sorted by use.

### Changed

- The web app's navigation runs on TanStack Router in place of wouter: typed routes and search params, loaders over the query cache with links and note tiles fetching ahead on hover or touch, and the router's scroll restoration in place of the app's own. A note opens as `?note=<id>` over the screen it came from; `/note/<id>` links still work.
- Phone headers stay put: Home, Notes, Tasks, the assistant and Settings scroll under one header shape; a Settings section wears it with a back chevron. Home's tag filter buttons are gone: the lens is the filter, and a badge click's tag shows as a clear chip. The task sheet's title wraps, its header is a close and a trash icon, and the keyboard no longer shrinks it.
- Thumbnails already drawn this session show at once on return.

### Fixed

- Going back from a note to Home no longer plays the notes layout in again or reloads the thumbnails: the screen a note was opened from stays mounted under the note's page, so Back finds it exactly as it was (the same for the task lists and Settings).
- Closing the on-screen keyboard with Android's Back gesture while writing to the assistant now also lets the field go and brings the tab bar back: the keyboard's presence is read from the viewport, not from focus alone.

## 0.4.0 - 2026-11-08

### Changed

- The public site and its phone screens now present the installed web app as the phone client (install from Chrome, share target,
  offline, task reminders, a polished animated UI) in place of the Android app, with no APK download button; the README, the
  self-host skill and the Push reminders section say the same, and the Android app is noted as frozen.
- A release no longer builds an APK: `release.yml` attaches the extension zip only.

### Fixed

- Closing a note on the phone returns to Home where it was left: the scroll, the task box's list and its tag filter are
  kept; the other lists and Tasks keep their scroll the same way.
- The assistant's on-screen keyboard closes after Send on the phone (the first tap still sends).
- The phone's Notes header controls (tag filter, layout, sort, +) are one size and style, matching the task box's header.
- Scrolling Upcoming in Home's task box moves the days strip to the day at its top.

## 0.3.0 - 2026-11-08

The web app, installed from Chrome on Android, is now the phone client. The Android app stays in the repository for this
release but gets no new features.

### Added

- The web app is an Android share target: a link, text, photos or a PDF shared from any app land in a `/share` screen that
  files them through the clip routes (a suggested note, an open task, a new note or task, or the assistant).
- Offline: notes, tasks and links are kept in IndexedDB and edited offline with the phone's sync contract (pull, push with
  the base `rev`, a 3-way merge for notes, a field merge for tasks, conflicts listed in Settings → Server & sync); viewed
  attachments are cached. An offline bar shows what waits.
- Task reminders as Web Push notifications to the installed app, sent by the agent every minute (`push_subscriptions`,
  `push_sent`; a VAPID key, `TEF_NOTES_VAPID_SUBJECT`, and the server's `TZ`). Settings → Reminders turns them on per device.
- A phone layout below the `md` breakpoint: bottom tabs (Home, Tasks, Ask, Settings), a days strip, the task box, a search
  drawer, tasks and their pickers as bottom sheets, swipe rows (When / Delete), a 1.5 s tick with Undo, long-press menus,
  a grip handle to reorder, safe areas, toasts at the top.
- Animate UI as the UI library (`@animate-ui/react`): animated primitives behind the shadcn components, a tick box, task
  rows that enter, leave and reflow, gliding highlights on every tab strip, scroll fades, status swaps, field shakes,
  skeleton reveals, a theme wipe. Motion follows the OS's reduced-motion setting.

### Changed

- The service worker is a source worker (`web/sw/sw.ts`): the share target, attachment caching and push handling live
  there, and a new deploy is still taken on the toast's Reload.
- The status and navigation bars of the installed app follow the chosen theme.

### Removed

- `vaul` and `tw-animate-css` from the web app.

## 0.2.0 - 2026-11-08

### Added

- Search by asking: when the search box finds nothing, the assistant searches notes and tasks by meaning and lists what fits and why (web palette and the phone's search drawer). No chat is saved and nothing is written.
- A per-message effort for the assistant (quick, normal, deep), setting how many steps it takes and how hard it reasons.
- The editor draws a link alone on its line as a card with a Copy button; a link's summary is the card's lower half.
- The assistant can summarise a note's links (`summarise_links`), writing the same block as the Summary button.
- The assistant and MCP tools can create and update tag definitions, including their colour and auto-tagger description.

### Fixed

- Work made on `main` after the launch branch point, missing from 0.1.0, is restored.
- A link preview from a rate-limited or failing site is retried later, not cached as an empty card for an hour.
- A link the assistant keeps goes alone on its line, so the editor draws its card.
- The clipper's popup scrolls inside a fixed height, so it can no longer lock up past Chrome's size cap.

## 0.1.0 - 2026-11-07

The first public release.

### Notes

- Markdown notes with a small frontmatter (`title`, `tags`, `color`, `pinned`), checkboxes, tables and code, in any language.
- Link previews and a Reader view of the linked article; photos, PDFs and Excalidraw drawings in a note.
- Tasks can be linked to the notes they are about, and a note lists what links to it.
- Every write carries the `rev` it was based on; two devices editing the same note are merged, and a real overlap is a conflict, never a silent overwrite.

### Tasks

- Inbox, Today, This Evening, Upcoming and Logbook views, as in Things.
- Checklists, due dates, reminders and repeating tasks (`2w`, `+3d`, `mon,thu`), with tags.

### Lenses

- Saved filters over tags: while one is on, every list, count, search and tag view shows only what it covers, a new note or task inherits its first tag, and it tints the app. Definitions live on the server, which lens is on is each device's own.

### Agent

- A chat assistant in the Ask tab on the phone and a dock on every web screen; it sees the page you are on, searches and reads notes and tasks, and edits them, asking you first with a confirm card.
- Reads a link's article, a note's PDFs and pictures; once a chat has read the web, every write in it needs your confirmation.
- The same note and task tools over MCP for other agent harnesses.
- An optional auto-tagger that files notes under your tags; tag descriptions written on request.
- One model provider per server, chosen in `server/.env`, with optional JEV and Exa keys; without a key the feature is off and the rest works.

### Chrome clipper

- "Save to TEF Notes" for a page, a selection, a link or a picture: the server suggests the notes and open tasks it fits, you pick, add a note and tags, and optionally a summary, and save to a note, a new note, a task or a new task.
- Built, signed and served by the server for Chrome to install and update by policy, or loaded unpacked.

### CLI

- `tefnotes`: read, search, append, edit and export notes and tasks from a terminal or a coding agent, with every write a compare-and-swap.

### Web app

- A laptop client served by the same server, with the phone's editor: notes, tasks, lenses, tags and the assistant dock.

### Android

- An offline-first app: a local SQLite cache with background sync, home-screen and lock-screen widgets, task reminders and a share target for text, pictures and PDFs.
- Home with the day at a glance, the task box and every note as tiles; Ask and Settings tabs.

### Self-hosting

- Published multi-arch images on GHCR, `docker compose up -d` pulls them; the signed extension is a build from source. PocketBase and the agent bind loopback only.
- There is no sign-in: reach it only through a reverse proxy on a private network, never the public internet ([SECURITY.md](SECURITY.md)).
- Released under the GNU AGPL-3.0.
