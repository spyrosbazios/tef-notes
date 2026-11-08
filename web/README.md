# TEF Notes web app

<!-- reviewed: 2026-11-08 -->

The laptop client for [TEF Notes](../README.md): browse and edit notes and tasks, view photos, PDFs and
drawings, and chat with the agent. React 19, Vite 8, Tailwind 4, shadcn/ui, TanStack Query, wouter and axios.

There is no sign-in. The app talks to the server it was loaded from, so the server must only be reachable over a
private network (see [`../server/README.md`](../server/README.md)). How the pieces fit, the note format and the write
contract are in [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## Requirements

- [bun](https://bun.sh) for installs and scripts, and Node.js for the tools Vite and shadcn run on.
- The whole repository cloned, not just `web/`: the app imports the shared code from [`../packages/core`](../packages/core/README.md)
  and its fonts and icon from `../mobile/assets/`.
- A running TEF Notes server to talk to (`server/`, `docker compose up -d --build`).

## Quick start

```sh
cd web
bun install
TEF_NOTES_SERVER=https://your-server:port bun run dev
```

`TEF_NOTES_SERVER` is the origin of your server; the dev server proxies `/api` and `/agent` to it, so you work on
your real notes. Without it the app loads but has nothing to talk to.

## Scripts

| Script | Does |
|---|---|
| `bun run dev` | Vite dev server with hot reload; proxies `/api` and `/agent` to `TEF_NOTES_SERVER` |
| `bun run build` | Type-checks (`tsc -b`), then builds the app into `dist/` |
| `bun run typecheck` | `tsc -b` over the app, the Vite configs and `test/` |
| `bun run lint` | oxlint. Three `only-export-components` warnings in `src/components/ui/` are shadcn's own |
| `bun run test` | `bun test` over `test/` (editor markdown, link cards, task writes, links, lenses, the assistant) |
| `bun run build:editor` | Builds the phone's note editor page into `mobile/src/ui/editor-html.ts` (see below) |
| `bun run build:pdf` | Builds the phone's PDF viewer page into `mobile/src/ui/pdf-html.ts` (see below) |
| `bun run preview` | Serves the built `dist/` locally |

## How it reaches the server

Everything is a same-origin request: `/api` goes to PocketBase and `/agent` to the chat agent. Production gets that
from the server itself, which serves the built app from `pb_public`; in development the Vite proxy stands in for
it. The transport is `src/services/` (axios); a stale write is mapped to the core's `Conflict`, and the app merges
and retries as the phone does.

## The assistant

The agent is a dock on the right, not a page: `src/components/assistant/dock.tsx` is mounted once in the shell (`App.tsx`),
beside the page from `xl` up (the page shrinks; its left edge drags to resize), over it below that. The rail's Assistant
item, the header's sparkles button, `a` and Ctrl/Cmd+`/` toggle it; open, width and the current chat are kept per browser
(`src/hooks/dock.ts`). The `Chat` itself lives in `src/components/assistant/provider.tsx`, above the routes, so navigating
or closing the dock never drops the thread or a reply still streaming; New chat and the saved chats are in the dock's bar.

Every request carries `context` (the contract: [`packages/core/src/assistant.ts`](../packages/core/src/assistant.ts)), built
as it goes out from the URL, the query cache and the selected text (`pageContext` in `src/lib/assistant.ts`). The agent's
UI tools (`open_note`, `open_task`, `go_view`) are done through the nav and always answered; the turn resumes
by itself after a card's answer or a UI tool's (`resumes`). What the agent writes reaches the page through the realtime
feed, as any client's writes do. A note's "Ask about this" opens the dock with a draft naming it; there is no `/ask` page.

## Home and search

Home (`src/components/home.tsx`) is the date, the task box (Today, Inbox and Upcoming as their views draw them, `TaskList
embedded`, with its own tag filter) beside the month's planner (`planned.tsx` over `@/core/planner`, which the phone draws
as a week), then every note as the Notes view's tiles (`NoteList`: masonry read by rows, thumbnails, filter and `#tag`,
multiselect, the sort from `@/core/note-sort`, 30 tiles at a time as the page scrolls). Every + opens the new-task dialog (`quick-add.tsx`) started from where it was pressed, with
the card's When, deadline, repeat, reminder and tags (`task-fields.tsx`, shared with `task-detail.tsx`).

A note is a page of its own, `/note/<id>` (`note-page.tsx` around the editor, `note-pane.tsx`): no rail, a Back that returns to
where the note was opened from (Home when the page was opened by its address). Every way of opening a note goes there. "New note"
(`hooks/new-note.ts`) makes an "Untitled" note at once and opens it with the title selected.

Ctrl/Cmd+K is the global palette: notes, tasks (done ones too), tags and views. While the dock is closed, a round
button at the corner opens it (`assistant/fab.tsx`).

## Phone layout

Below `md` (768px) the app is the Android app's layout, so the installed PWA can stand in for it (the phone's own map:
[`../mobile/AGENTS.md`](../mobile/AGENTS.md)). The shell (`App.tsx`) swaps the rail and the app bar for the phone's bottom tabs
(`components/tab-bar.tsx`: Home, Tasks, Ask, Settings, a floating pill with the front tab's label on a capsule; hidden on a note
page, with a task open and under the on-screen keyboard, `hooks/keyboard.ts`). Tasks goes back to the list last in front. Ask is the
assistant's dock opened whole above the bar (`--dock-bottom`), so it is "in front" while the dock is open and any other tab closes it;
the dock's X and the corner button are not there, and its history button is the phone's Chats. Home is the phone's Home: a header
with the lens (the app's mark, `LensSwitcher header`) and a search button, then the days strip (`components/days.tsx` over
`@/core/planner`, where the laptop has the month: tap a day to show it in the task box, hold one to add a task that day), the
same task box at a fixed height, then the notes in two columns (`columnCount` in `lib/masonry.ts`), a header of icons (tag filter,
tiles or grouped, sort, +) and tiles showing two tags, held to select (a wider screen's hold opens the tile's menu). Search is a
drawer taking Home's place (`components/search-drawer.tsx`): `#tag` chips, notes, tasks, tags, the views, and "Search with the
assistant" when nothing matches; it and the palette (⌘K, laptop) share their data in `hooks/search.ts` and the note row in
`components/note-hit.tsx`. Differences from the Android app: scroll-snap stands in for the strip's drag physics (a day does not
spring as it nears the slot, it steps), the strip does not follow Upcoming scrolled by hand, and a search result's long press opens
the laptop's note menu. Where `md` and up draws the laptop's layout, nothing changes.

## Links

A task's notes and a note's tasks are `links` records (the model: [`../ARCHITECTURE.md`](../ARCHITECTURE.md), "Links"),
held as one list (`src/hooks/links.ts`, calls in `src/services/links.ts`, kept live by the realtime feed) and read through
`src/lib/links.ts`. The open task's Notes row adds and removes as many as it likes. A note lists the tasks linking to it under its title
(`src/components/linked-tasks.tsx`). Ticking a repeating task makes its links again from the next round.

## Deployment

You do not deploy `web/` on its own. The server image builds it into `pb_public`, so one
`docker compose up -d --build` in `server/` ships the server, the web app and the extension together
([`../server/README.md`](../server/README.md)).

The app is installable: `vite-plugin-pwa` (`vite.config.ts`) precaches the build and registers a service worker
that checks for a new one on load and hourly. A new deploy is offered by a toast with a Reload button
(`src/components/update-toast.tsx`), never swapped in under an open note. Nothing the server answers is cached by the
worker except attachment and link-picture files (below, Offline): `/api`, `/agent`, `/_/` and `/extension/` bypass its page fallback.

## Offline

The installed app opens, browses and **edits** without the server. The service worker precaches the app. Notes, tasks and links live
in a local copy in IndexedDB (`tefnotes-sync` database, `src/lib/local.ts`, over idb-keyval: held whole in memory, written behind
it); everything on screen is read from it, every edit is written to it first, and a sync reconciles it with the server. The sync
is the phone's contract ported into `packages/core/src/sync.ts` (the logic, tested over a fake server in
`packages/core/test/sync.test.ts`) and run by `src/lib/sync.ts`; the phone's own, which it mirrors, is in
[`../mobile/AGENTS.md`](../mobile/AGENTS.md) "Storage and sync contract".

- **Edits:** a note row holds its text, the `rev` it was last in step with and `base`, the text as of that `rev`; a task row its
  record and `base`; a link its `pushed` time. An edit marks the row unsent and goes up 1.5 s after the last one, when the page
  comes to the front or goes to the back, when the browser comes back online, on leaving a note, and on any realtime event that is
  news (not the echo of what this app sent). One sync runs at a time; a request while one runs asks for one more after it.
- **Merging:** a push names the `rev` it was based on (the write contract, [`../ARCHITECTURE.md`](../ARCHITECTURE.md)); a stale
  one is never resent. A note both sides edited is merged by lines against `base`; where the edits overlap nothing is sent and the
  note is listed under **Settings > Server & sync > Conflicts**, where the owner keeps the text made here or uses the server's
  (which keeps the replaced text to restore), as on the phone. A task is merged field by field, this side winning a field both
  changed, so it never conflicts. A new note whose path another device took first goes up as `-2`. Links are a set of ids: an
  add is idempotent, a delete is a tombstone, and an add whose end is gone from the server is dropped.
- **Shown:** `src/components/offline-bar.tsx` says so while the server can't be reached and "N changes waiting" while rows are
  unsent (online, after a few seconds, so a save doesn't flash it). Offline state is `src/lib/net.ts`: the browser says so, or a
  request or the realtime stream could not reach the server. Coming back, the realtime feed reconnects and a sync runs.
- **Kept besides:** the query cache keeps tags, lenses, the photo lists and link previews (`persistable` in
  `src/lib/persist.ts`; a new kind of query is not kept until added there), for up to 7 days. Attachment files, their thumbnails
  and links' saved pictures (`/api/files/attachments/` and `/api/files/link_previews/` on this origin, nothing else) seen once
  are kept by the service worker (`sw/sw.ts`, cache `attachment-files`, at most 400 files for 30 days); a picture never
  opened online is not there offline, and a PDF read in parts is not cached.
- **Not covered, and failing at once offline with a toast** (`Offline` in `src/services/api.ts`: the sync's own requests are
  marked `synced`, every other write is refused up front): attachment uploads, drawings, the assistant (chats, models, replies),
  search by asking, reader view, clips, tags, lenses and push subscriptions. They have no local copy to wait in. Mutations of
  those keep TanStack's `networkMode: "always"` (`src/root.tsx`) so they fail instead of pausing.
- **Differs from the phone:** a note made here has no server record id until it first goes up, so it can't be linked to a task
  before then (the picker leaves it out); a new note is checked against the server for a free path when it can be reached, and a
  clash found at the push moves the note to `-2` without moving photos uploaded to it meanwhile (the phone moves them); there is no
  background sync after the page closes, so changes wait for the next visit; no "restore" banner on a note's own page (Settings
  lists them); notes are fetched whole, as the phone does.
- **If IndexedDB is unavailable** (a private window) the app runs on memory: edits sync while the page is open and are lost with
  it.
- **To clear it:** Settings > Server & sync > Clear the offline copy (refused while changes wait), or the browser's site data
  (the `tefnotes-sync` and `tefnotes` IndexedDB databases and the `attachment-files` cache in DevTools > Application). A cache
  from another build is discarded: each build has an id (`vite.config.ts` `define`) used as the query cache's `buster`; the local
  copy is not versioned, and a change to its rows is a migration or a reset of the database.

## Share target

Installed from Chrome on Android ("Install app"), TEF Notes is in the Share sheet of other apps: a link, text, photos or a
PDF shared to it open the Share page (`src/components/share-page.tsx`, `/share`). The manifest's `share_target`
(`packages/core/vite.ts`) makes the browser POST the share to `/share`; the service worker (`sw/sw.ts`) reads the form once,
stashes it in the Cache API (`packages/core/src/share-stash.ts`) and redirects to `/share?shared=1`, where the page takes it
out. Android puts a link in `text`, not `url`: `fromPost` (`packages/core/src/share.ts`) finds it. The page files a link,
text or one photo through the server's clip routes as the extension and the phone do (`src/services/clip.ts`, the shapes
and the contract in [`../extension/AGENTS.md`](../extension/AGENTS.md)); PDFs and several photos become a new note with the
files attached; "Ask the assistant" hands any of it to the chat. A lens's first tag goes on what is made.

Firefox and iOS Safari have no share target. `/share` opened directly shows a box to paste a link or text into, which
goes the same way. A share needs the worker installed: after a deploy, the first share can still reach the old one.

## Reminders

A task with a day and a reminder time can notify the phone the way the Android app does, through Web Push. In Settings >
Reminders, "Task reminders on this device" asks for the notification permission, subscribes this browser with the server's key
(`GET /agent/push/key`) and hands the subscription over (`POST /agent/push/subscribe`, `src/hooks/push.ts`, `src/services/push.ts`);
turning it off removes it from the server and the browser. Each device turns it on for itself. The server sends the reminder at
its time whether or not the app is open: the service worker (`sw/sw.ts`) shows it and a tap opens the task (the contract:
[`../packages/core/src/push.ts`](../packages/core/src/push.ts)). It needs the server's VAPID key and subject
([`../server/README.md`](../server/README.md)); without them the switch says "Not available". The server's `TZ` must be yours:
a reminder's time has no zone and is read in the server's. It also needs the installed app's service worker (a dev server has
none): Chrome on Android with the app installed, or on iPhone the app added to the Home Screen. A tap on a reminder asks the
open app to go to the task (`src/components/update-toast.tsx`; it never reloads the page, so a note being typed is kept) and opens
a window only when there is none. While the Android app is still installed too, both ring: remove its reminders (or the app)
on that phone to have one.

## Phone width

Below `md` (768px) the web app takes the phone's shapes. A task opens as a bottom sheet over its list (the shadcn drawer, vaul)
and its pickers (When, Deadline, Repeat, Reminder, Tags, Notes) are sheets over that (`src/components/pick.tsx`: a popover in a
window, a sheet here); the new-task form is a sheet too. Under a finger a task row swipes as the phone's does
(`src/hooks/swipe.ts`, geometry in `src/lib/swipe.ts`: right asks When, left brings out Delete; the grip handle still reorders).
A tick waits 1.5 s before it is written and a toast's Undo, or a second tap on the box, takes it back
(`src/hooks/linger.ts` over `packages/core/src/tick.ts`). The Tasks page has the Inbox, Today, Upcoming and Logbook as tabs, and
Settings is a list of sections opening one by one. The note's menu shares its `.md` through the system share sheet where the
browser has one for files, and downloads it elsewhere.

## Touch

A finger among the pointers is the switch, not the width: Tailwind's `any-pointer-coarse:` variant in CSS and `touching()` in
`src/hooks/media.ts` in code (a tablet or a wide phone has no hover either, and a laptop with a touch screen counts). Under it the
hover-only controls show, and a hold stands in for a right-click: a long press (`src/hooks/long-press.ts`) opens a tile's or a
result's menu and, on Home's days, adds a task to the day. A task row's grip handle reorders and its swipe asks When or brings
out Delete (Phone width, above). A tick buzzes briefly, as a swipe does, where the browser can (`navigator.vibrate`).

## The phone's pages

The phone's note editor and PDF viewer are web pages inside a WebView, built from this module so the editor is the
same on both. `build:editor` (from `editor-host/`) and `build:pdf` (from `pdf-host/`) each produce one
self-contained HTML file, written into the app as a string module (`mobile/src/ui/editor-html.ts`,
`mobile/src/ui/pdf-html.ts`). The two files are generated and gitignored (they are about 1 MB and 2 MB), so a fresh
checkout has none: the mobile scripts build them first, see [`../mobile/README.md`](../mobile/README.md).

## shadcn

`src/components/ui/` is shadcn's output. Add a component with

```sh
bunx --bun shadcn@latest add <name>
```

and never edit those files by hand; change how something looks in the app's own components or in `src/index.css`.
Icons come from lucide, the library `components.json` configures.

## Colours

The app has no colours of its own. The palettes live in `@/core/theme` ([`packages/core`](../packages/core/README.md)).
Vite turns the default one into `--tf-*` CSS variables at build time (`packages/core/vite.ts`), `src/index.css` maps
shadcn's tokens onto them, and `src/hooks/appearance.ts` re-sets them to the theme and accent picked in Settings >
Appearance (kept per browser), so a colour change is a change to the palette and reaches the phone, the site, the
extension and the web app together.
