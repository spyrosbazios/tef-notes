# Changelog

All notable changes to TEF Notes. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
version is one semver number for the whole repository, set by the git tag (see [CONTRIBUTING.md](CONTRIBUTING.md#versioning)).

## Unreleased

### Agent

- Answers cite what they read: a note, page or PDF the agent read is linked in the sentence it backs, and the clients turn those links into numbered sources — the web a chip with a hover preview and a list at the end, the phone the number inline and a list under the answer.

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
