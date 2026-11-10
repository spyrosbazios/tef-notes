# TEF Notes web app

<!-- reviewed: 2026-11-08 -->

The laptop client for [TEF Notes](../README.md): browse and edit notes and tasks, view photos, PDFs and
drawings, and chat with the agent. React 19, Vite 8, Tailwind 4, shadcn/ui, TanStack Query, TanStack Router and axios.

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

The agent is a dock on the right, not a page: `src/components/assistant/dock.tsx` is mounted once in the shell (`components/shell.tsx`),
beside the page from `xl` up (the page shrinks; its left edge drags to resize), over it below that. The rail's Assistant
item, the header's sparkles button, `a` and Ctrl/Cmd+`/` toggle it; open, width and the current chat are kept per browser
(`src/hooks/dock.ts`). The `Chat` itself lives in `src/components/assistant/provider.tsx`, above the routes, so navigating
or closing the dock never drops the thread or a reply still streaming; New chat and the saved chats are in the dock's bar.

Every request carries `context` (the contract: [`packages/core/src/assistant.ts`](../packages/core/src/assistant.ts)), built
as it goes out from the URL, the query cache and the selected text (`pageContext` in `src/lib/assistant.ts`). The agent's
UI tools (`open_note`, `open_task`, `go_view`) are done through the router (`useNav`, `lib/nav.ts`) and always answered; the turn resumes
by itself after a card's answer or a UI tool's (`resumes`). What the agent writes reaches the page through the realtime
feed, as any client's writes do. A note's "Ask about this" opens the dock with a draft naming it; there is no `/ask` page.

## Home and search

Home (`src/components/home.tsx`) is the date, the task box (Today, Inbox and Upcoming as their views draw them, `TaskList
embedded`) beside the month's planner (`planned.tsx` over `@/core/planner`, which the phone draws
as a week), then every note as the Notes view's tiles (`NoteList`: masonry read by rows, thumbnails, filter and `#tag`,
multiselect, the sort from `@/core/note-sort`, 30 tiles at a time as the page scrolls). Every + opens the new-task dialog (`quick-add.tsx`) started from where it was pressed, with
the card's When, deadline, repeat, reminder and tags (`task-fields.tsx`, shared with `task-detail.tsx`).

A note is a page of its own laid over the screen it was opened from, `?note=<id>` (`note-page.tsx` around the editor,
`note-pane.tsx`; see Routing): no rail, a Back that returns to where the note was opened from (the screen under it when the page was
opened by its address). Every way of opening a note goes there. "New note"
(`hooks/new-note.ts`) makes an "Untitled" note at once and opens it with the title selected.

Ctrl/Cmd+K is the global palette: notes, tasks (done ones too), tags and views. While the dock is closed, a round
button at the corner opens it (`assistant/fab.tsx`).

## Phone layout

Below `md` (768px) the app is the Android app's layout, so the installed PWA can stand in for it (the phone's own map:
[`../mobile/AGENTS.md`](../mobile/AGENTS.md)). The shell (`components/shell.tsx`) swaps the rail and the app bar for the phone's bottom tabs
(`components/tab-bar.tsx`: Home, Tasks, Notes, Ask, Settings in the owner's order, a floating pill with the front tab's label on a capsule; hidden on a note
page, with a task open and under the on-screen keyboard, `hooks/keyboard.ts`). A note's page is a layer over whatever screen it was opened
from (`NoteLayer` in `components/shell.tsx`; Home, a task list or Settings): that screen stays matched and mounted under it, `invisible`
and `inert` (Routing, below), so Back finds it as it was, with no tiles entering again, no
pictures reloaded and the scroll where it was left; the focus goes into the note and back to the tile. Tasks goes back to the list last in front. Ask is the
assistant's dock opened whole above the bar (`--dock-bottom`), so it is "in front" while the dock is open and any other tab closes it;
the dock's X and the corner button are not there, and its history button is the phone's Chats. Home is the phone's Home: a header
with the lens (the app's mark, `LensSwitcher header`) and a search button, then the days strip (`components/days.tsx` over
`@/core/planner`, where the laptop has the month: tap a day to show it in the task box, hold one to add a task that day), the
same task box at a fixed height, then the notes in two columns (`columnCount` in `lib/masonry.ts`), a header of icons (
tiles or grouped, sort, +) and tiles showing two tags, held to select (a wider screen's hold opens the tile's menu). Search is a
drawer taking Home's place (`components/search-drawer.tsx`): `#tag` chips, notes, tasks, tags, the views, and "Search with the
assistant" when nothing matches; it and the palette (⌘K, laptop) share their data in `hooks/search.ts` and the note row in
`components/note-hit.tsx`. Differences from the Android app: scroll-snap stands in for the strip's drag physics (a day does not
spring as it nears the slot, it steps), the strip does not follow Upcoming scrolled by hand, and a search result's long press opens
the laptop's note menu. A list comes back where it was left: the router restores each list's scroll (Routing, below), and Home keeps its task box (the
list in front) for as long as the app is open. Upcoming scrolled by hand moves the days strip to the
section at its top (`TaskList`'s `onView`); the strip answers only a drag of its own, never its own sliding. The phone's header controls (tag
filter, layout, sort, +) are one 40px outlined square each (`TOOL` in `note-list.tsx`, shared by the task box). Sending closes the assistant's keyboard
(the Send tap still keeps the focus, so it lands first time). Where `md` and up draws the laptop's layout, nothing changes.

## Routing

[TanStack Router](https://tanstack.com/router/latest/docs/framework/react/overview) with file routes: `src/routes/` is the tree,
`@tanstack/router-plugin`'s Vite plugin (`vite.config.ts`, before `react()`) generates `src/routeTree.gen.ts` on `dev` and `build`
(generated, committed so `tsc -b` sees it; never edit it) and splits each route's component into its own chunk. The router, its
options and the query client are `src/router.ts`; `src/root.tsx` puts it under the providers.

| Route | File | Screen | Search |
|---|---|---|---|
| (root) | `__root.tsx` | `components/frame.tsx`: the assistant's chat, toasts, update toast, devtools in dev; 404 `components/not-found.tsx` | |
| (layout) | `_app.tsx` | `components/shell.tsx`: rail, app bar, tabs, dock, palette, and the note over the screen | `note` |
| `/` | `_app/index.tsx` | Home; a bare launch goes on to the chosen start screen (`lib/start.ts`, `beforeLoad`) | `tags` (a comma list) |
| `/inbox` `/today` `/upcoming` `/logbook` | `_app/<list>.tsx` | `components/task-screen.tsx`: the list and the task beside it | `t` (task id) |
| `/notes` | `_app/notes.tsx` | `notes-page.tsx`: the notes alone (its tab off until turned on in Settings → Layout) | `tags` (a comma list) |
| `/settings` | `_app/settings.tsx` | `settings-pane.tsx` | `section` |
| `/share` | `share.tsx` | `share-page.tsx`, outside the shell | `shared` (`1`, `err`) |
| `/note/$id` | `note.$id.tsx` | redirects to `/?note=<id>`, replacing itself | |
- **Route transitions** are the router's View Transitions, typed by what changes (`router.ts` `transitionOf`, drawn in
  `src/index.css`): `view` crossfades only the page (`data-vt="page"` around the `Outlet`, `shell.tsx`; 150 ms on a phone, 200 ms
  wider) while rail, bars and dock hold still; `note-open`/`note-close` slide the note's layer (`data-vt="note"`) up and back down on
  a phone and fade it from `md`, the direction read from `?note=` coming or going (Back, the note's Back and links alike);
  `note-grow`/`note-shrink` grow it out of the tile it was opened from and back (`lib/morph.ts`); `note-swap` crossfades one note
  for another; `whole` for the share page; a tag-filter change or a task opened or closed (`?t=`: the phone's sheet has its own motion) has none. Animate UI's Page Transition for TanStack Router is a
  registry file (shadcn CLI), which this app doesn't take (package only), so the CSS uses its tokens' timings instead. The screen
  under a note stays mounted and keeps its scroll.

- **Search params** are plain, `?t=abc&tags=a,b`, not the router's JSON default: `parseSearch`/`stringifySearch` and every route's
  `validateSearch` are `src/lib/route-search.ts` (tested in `test/route-search.test.ts`), so the addresses handed out (Copy link's
  `/note/<id>`, a reminder's `/today?t=<id>`, the share target's `/share?shared=1`) stay what they were. A validator drops what it
  doesn't understand. Read a route's own search with `useSearch({ from })`; the loose `strict: false` one carries the raw query.
- **The note layer.** A note is `?note=<id>` on whichever shell screen it was opened from, so that screen stays the matched route and
  mounted under the note (no remount, no tiles entering again, scroll untouched); Back pops the param. `/note/<id>` is kept as the
  public address and redirects. `usePlace`/`useNav` (`src/lib/nav.ts`) are the typed verbs (`openNote`, `showTask`, `goView`,
  `filterTag`…) and `linkOf(view, { task, note })` the typed link for any place; `router` is exported for code outside React (the
  service worker's `navigate` message in `update-toast.tsx`).
- **Data and preload.** Loaders take `context.queryClient` (`createRootRouteWithContext`) and only touch the query cache
  (`src/lib/loaders.ts`): the shell screens `ensureQueryData` the notes, tasks and links (the local copy, instant once open) and
  prefetch tags and lenses without waiting (not on a hover's preload, which asks every few seconds: the screen asks for them itself);
  a note about to open prefetches its attachment list. `defaultPreload: "intent"` with
  `defaultPreloadStaleTime: 0` (the router keeps no second cache; TanStack Query's staleTime decides). Task rows, the task tabs and
  Settings' sections are `Link`s; a note tile keeps its own click, long press and selection, and gets the same intent preload from
  `useIntent`. A cold load (first sync) shows `components/pending.tsx` after `defaultPendingMs` (400 ms), never a flash.
- **Scroll restoration** is the router's (`scrollRestoration: true`). Each scroller carries a `data-scroll-restoration-id` from
  `src/lib/scroll.ts` (Home per badge tag and lens, each list, each box list, each settings section, and one per open note, task and
  chat), and `getScrollRestorationKey` is one constant, so a place is kept per scroller, not per history entry: a tab, the rail or
  Back all find it, and an id never seen (another note) starts at the top (`scrollToTopSelectors`). Home's scroller has
  `overflow-anchor: none` (the browser's anchoring otherwise moved the restored place while the masonry measured), and Home draws
  enough tiles for the restored depth up front, on mount and on each new filter or lens (`useSavedScroll`, `note-list.tsx`).
  A lens (or the task box's list) is switched on the page, not navigated to, and the router saves a place only as a navigation
  starts: `useScrollSwitch` (`src/hooks/scroll.ts`) keeps each id's place as it scrolls and puts it back when the id changes. The lens
  stays each device's own state (`hooks/lens.ts`), not a search param: it filters every screen and the code that makes a note or
  task reads it outside React, so a URL copy would be a second source.
- **View transitions:** every navigation is one of type `route` (`defaultViewTransition: { types: ["route"] }`, off when the OS asks
  for reduced motion, read once in `router.ts`); nothing styles it yet, so the browser's crossfade plays: the seam for a page
  transition. The theme and accent change is its own, type `look` (`hooks/appearance.ts`), and the wipe in `index.css` is scoped to
  `:active-view-transition-type(look)`. A browser without typed transitions gets a cut for both: the router passes `false` there, so the user agent's own crossfade never plays and no tile is named (`lib/morph.ts` `arm`).
- **Adding a route:** a file under `src/routes/` (`_app/<name>.tsx` to sit in the shell) exporting `Route = createFileRoute(...)`, its
  `validateSearch` in `lib/route-search.ts` with a test, a `loader` that only asks the query cache, a `data-scroll-restoration-id` on
  its scroller; `bun run dev` or `build` regenerates the tree. A new view kind also goes in `View`, `viewOf` and `linkOf`.
- **Deep links** need the server's SPA fallback (PocketBase serves `index.html` for unknown paths from `pb_public`) and the service
  worker's (`NavigationRoute` in `sw/sw.ts`, which leaves `/api/`, `/agent/`, `/_/` and `/extension/` alone).

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

## Motion

Overlays, menus, switches, toggles and collapsibles move through [Animate UI](https://animate-ui.com)'s
`@animate-ui/react` package (a Motion-based drop-in for Radix, and for vaul's drawer: `ui/drawer.tsx` and `Pick`'s nested sheet). Only the
npm package is used: none of its registry files (icons, backgrounds) are copied into the repo. `src/components/ui/` reaches it through
`bunx @animate-ui/cli@latest animate <component>` after a `shadcn add`, never by hand. Motion we write ourselves takes its values from
`@animate-ui/react/utils/motion` (`spring`, `transition`, `scale`, `useTempoTransition`), as the palette (`palette-dialog.tsx`, a quick
fade and slight scale: it opens all day from the keyboard, so not the dialog's tilt) and `assistant/turn.tsx`'s `Rise` do.
State changes reuse three small pieces: `components/swap.tsx` (a label or icon swapping in place, `Turns` reserving the widest label's
width: Save → Saving…, the note's save state, the offline count), `components/loaded.tsx` (a skeleton giving way to its content) and
`hooks/shake.ts` (a field in error, once). The offline strip unfolds in height, the assistant's dock slides in only between `md` and
`xl` (docked it does not move, on the Ask tab it fades), and Home's tiles glide between columns on a wide screen only.
The full-screen viewers pass `data-side="bottom"` to `DialogContent` on a phone so they slide up like a sheet. The overlays' colour is
the theme's scrim (`[data-slot$="-overlay"]` in `src/index.css`). `bun x @animate-ui/cli@latest audit src` lists what moves and what
it costs.

The rest, one line each:
- `ui/checkbox.tsx` is the animated checkbox and `components/tick-box.tsx` its round task/checklist tick (`sm`, `md`, `lg`): controlled by `checked`, a tick's write waits its linger (`hooks/linger.ts`).
- The task list (`task-list.tsx`, `task-row.tsx`): rows enter, leave and reflow with `layout="position"` presence; a leaving row or section is inert and hands its focus on, a returning one is live again.
- A swipe is a Motion value (`hooks/swipe.ts`'s `x`): the row follows the finger, and the When star and Delete button read it through `useTransform`.
- Bottom Navigation (`tab-bar.tsx`): the phone's tab bar with its sliding highlight; the label is on `spring.slide`, as the spring's default overshoots under a blur. It does not fold on scroll (`scrollBehavior` stays `none`): the bar is already one row of icons, so folding would reclaim no height, and `--tab-bar`/`--dock-bottom` stay fixed.
- Tile → note (`lib/morph.ts`): the clicked tile and the note's layer share the view-transition name `note-card` for that one navigation, so the box grows on `spring.morph`'s timing and its face crossfades (`transition.swap` out, `transition.reveal` in); closing shrinks it back into the tile if still on the page. Container only: the note's pictures are the editor's, drawn after the capture. The tile's own `layoutId` stays its masonry glide, with `useMoved` against doubling.
- Search drawer (`search-drawer.tsx`, phone): a sheet down from under the header (`transition.sheet` in, `transition.dismiss` out, a fade under reduced motion), results at once.
- Highlight: the one background that glides between Home's task tabs (`home.tsx`) and the underline under the task list's tabs (`task-list.tsx`).
- Scroll Fade: the task list's top and bottom edges and the days strip's sides; Copy Button: the assistant's "Copy answer" (`assistant/turn.tsx`); Shimmering Text: its "Thinking…" (`assistant/panel.tsx`).
- AutoHeight: a box that follows its content's height (the assistant's thinking line), so it opens and closes its space.
- Touch press: on a finger every `[data-slot="button"]` scales to .97 on `spring.press` from one CSS rule in `index.css`, so buttons carry no `active:scale` of their own.
- Lightbox (`lightbox.tsx`): a note's pictures in a Carousel (Animate UI's, Embla's drop-in, so `embla-carousel` and `embla-carousel-react` are peer packages): a finger swipes between them, buttons and arrow keys do too (a mouse does not drag: it would fight the zoom). On a laptop a click zooms the picture in where the pointer is (Image Zoom, the pointer pans it); on a phone a tap shows it at its own size, scrolled by hand. The counter is a Sliding Number. The viewer grows out of the place tapped (the dialog's tilt, with `transform-origin` at the last press). Embla's options never change while it is open (it deep-compares them each render and a changed one re-initialises it, which snaps a glide in flight): the start index is frozen and `watchDrag` is one function (touch only: any touch screen swipes, a mouse never drags).
- Reader view: a Scroll Progress bar in the brand colour under the header, shown only once the article is long enough to scroll. The PDF viewer and the drawing dialog fade their pages and canvas in over a skeleton (`Loaded`, whose `frame` sizes the box around both).
- Selection bar (`selection-bar.tsx`): selected words in a note get bold, italic, strikethrough, code and link right above them under a mouse (below them under a finger, clear of the handles and Android's Copy menu, fingertip-sized, no labels). Positioned with Floating UI against the selection (`Editor.selectionBox`, which waits for a mouse drag's release), it grows from its edge on `spring.pop` from `scale.popover`; its labels are Animate UI's own Tooltip (`@animate-ui/react/primitives/tooltip`), one popup gliding from button to button.
- Planned: Animate UI's own Tooltip (`@floating-ui/react` is its peer): one popup that glides and resizes from day to day under a mouse (`hooks/hover.ts`), none under a finger. The month's total is a Sliding Number, so a task scheduled elsewhere rolls it.
- Assistant: a block that appears while the reply is live rises in (`assistant/rise.tsx`, the list recipe), cards included; a chat row leaves on a fade and the rows below close the gap; an `ask_choice` option is pressed to `scale.choice` with Animate UI's Button under a mouse (a finger already scales every button from `index.css`). The skill has no recipe for streamed text, so it only appears as it arrives: nothing animates per token.
- Empty states (`components/empty.tsx`): the icon and its line fade in and rise once on `spring.slide`, no loop. A list inside a `Loaded` or an `AnimatePresence initial={false}` that is empty on first paint sits still: that flag reaches every motion element mounted later inside it.
- Counts: the task tabs' counts and the heatmap's total are Sliding Numbers (a tick lingers, the row goes, the digit rolls; it starts at its value, no count-up on mount). The checklist's items and a chat's rows are a list that keeps its shape (`hooks/presence.ts` takes a leaving item out of the tab order and hands its focus on).
- When picker: one background glides between its quick options under a mouse (Highlight, hover-capable pointers only) and the line that says what the typed words mean opens in height (Auto Height, which starts from a height of 0: only used where the box starts empty). The update toast's Reload is a status button: it says "Reloading…" in place.

Picking a theme or accent in Settings wipes the page from one look to the next (a View Transition in `hooks/appearance.ts` `set`, its timing in `index.css`: `transition.overlay`'s curve from the skill's `css-timing.mjs`); a lens's accent cuts, and reduced motion skips the wipe.
Reduced motion follows the OS setting only, no switch in the app (route transitions keep their fades, the note's slide and the tile's growth drop): `root.tsx` wraps the app in `AnimateUIProvider` and
`MotionConfig reducedMotion="user"`, `index.css` quiets the CSS loops (spinners pulse instead of turning), and scrolls that would glide
(`calm()` in `hooks/media.ts`) jump.

## Glass

The surfaces that float over scrolling content are liquid glass: `quick-liquid` (SVG backdrop refraction on Chromium, frost elsewhere),
its optics only, the motion still Animate UI's. One glass for all of them, `lib/glass.ts` (the theme's raised surface as the tint;
`hooks/glass.ts` for React, `glassOfPage` for a page built outside React): the phone's tab bar (`tab-bar.tsx`), the assistant's button
(`assistant/fab.tsx`) and the PDF page counter (`pdf/pages.ts`). Nothing else: a surface nothing scrolls under pays for glass and
shows none, at most two share a screen, and a full-width bar is not glass (the Notes header was tried: a square slab, declined). A snapshot can't carry a child's backdrop-filter, so a
glass surface a route change names gets its blur from the transition group instead (`index.css`, the tab bar).

## Colours

The app has no colours of its own. The palettes live in `@/core/theme` ([`packages/core`](../packages/core/README.md)).
Vite turns the default one into `--tf-*` CSS variables at build time (`packages/core/vite.ts`), `src/index.css` maps
shadcn's tokens onto them, and `src/hooks/appearance.ts` re-sets them to the theme and accent picked in Settings >
Appearance (kept per browser), so a colour change is a change to the palette and reaches the phone, the site, the
extension and the web app together.
