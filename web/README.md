# TEF Notes web app

<!-- reviewed: 2026-11-07 -->

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
(`src/components/update-toast.tsx`), never swapped in under an open note. Nothing the server answers is cached:
`/api`, `/agent`, `/_/` and `/extension/` bypass it.

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
