# Changelog

All notable changes to TEF Notes. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
version is one semver number for the whole repository, set by the git tag (see [CONTRIBUTING.md](CONTRIBUTING.md#versioning)).

## Unreleased

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
