# tefnotes: agent notes

**TEF Notes**: self-hosted notes and tasks: a PocketBase server (`server/`) with a chat agent beside it
(`server/agent/`), a web app (`web/`), an Android app (`mobile/`), a CLI (`cli/`) and a Chrome clipper (`extension/`),
all sharing `packages/core/`. What it is and how to run it: `README.md`. The note format, tasks, the write contract and
the server's jobs: `ARCHITECTURE.md` (not repeated here). Rules for changes: `CONTRIBUTING.md`. Security model: `SECURITY.md`.
Each module has its own `README.md` and, for `mobile/` and `extension/`, an `AGENTS.md`.

<!-- reviewed: 2026-11-07 -->

## Where facts live

| Path | Holds | Authority |
|---|---|---|
| `server/pb_migrations/` | Collections, fields, API rules (`1792900000_todo.js`: tasks; `1793000002_todo_tainted.js`; `1792600000_chats.js`: chats and `notes.tainted`; `1793300000_note_kind.js`: `notes.kind`; `1793300001_links.js`: `links`, which replaced `tasks.note`; `1793400000_drop_projects.js`: dropped `projects` and tasks' `project` and `heading`, a task that was in one keeps it as the first line of its notes; `1793500000_task_tags.js`: tasks' `tags`, `suggested`, `autotagged`, `tagged`; `1793600000_lenses.js`: `lenses`, the saved filters; `1793700000_lens_exclude.js`: their hidden tags; `1793800000_lens_accent.js`: the colour a lens gives the app; `1793900000_tag_described.js`: the notes count a tag's description was last auto-written at; `1794100000_autotag_only.js`: dropped notes' `suggested` and tasks' `suggested`, `autotagged`, `tagged` (a task's suggestions became tags first). `1793200000_screenshots.js`'s `screenshots` collection, `links`' `fromShot`/`toShot` and notes' `capture` kind are left from the removed screenshot captures: no code reads or writes them, and dropping them is the maintainer's call; `1794200000_thumbs.js`: a tile picture's two thumb sizes on attachments, and `link_previews.picture`, the server's copy of a link's picture; `1794300000_push_subscriptions.js`: `push_subscriptions`, the browsers reminders are pushed to, and `push_sent`, which reminders already went) | ⭐ canonical schema |
| `server/pb_hooks/rev.pb.js` + `lib/rev.js` | Compare-and-swap on `rev` for notes and tasks | ⭐ the write contract |
| `server/pb_hooks/notes.pb.js` | A note's path and kind never change (a create without a kind is a `note`); its photos deleted with it (its links go by the relations' cascade) | |
| `server/pb_hooks/links.pb.js` + `lib/links.js` | A link's shape: one `from`, one `to`, a role, never one record to itself (on every save); a clip to a new task links it to the note holding its picture | |
| `packages/core/src/record-links.ts` | Link types, wire columns, a task's notes, a note's backlinks, a repeating task's links carried over; calls: `pocketbase.ts` `links` (`core/links.ts` is a pasted URL's title, not this) | ⭐ links in code |
| `packages/core/src/sync.ts` | The offline sync engine the phone's contract was ported into: rows (notes with `base` and conflict state, tasks, links), local edits, pull and push over a `Transport`, the 3-way and field merges, one-at-a-time `coalesced`; the web runs it over IndexedDB (`web/src/lib/sync.ts`, `local.ts`), tests over a fake server in `test/sync.test.ts`; the phone still holds its own (`mobile/AGENTS.md`) | ⭐ the sync contract in code |
| `packages/core/src/todo.ts` | Task types (tags), patch rules, ticking (repeat rollover), Things' views, the field-level merge (tags as a set) | ⭐ tasks as records in code |
| `server/pb_hooks/autotag.pb.js` + `lib/autotag.js` | The auto-tagger: the notes cron, and the guess route a new-task form calls as it is typed (`tagGuesser`, `packages/core/src/tags.ts`) | ⭐ |
| `server/pb_hooks/clip.pb.js` + `lib/clip.js` | The clip routes (suggest, then save; to a note, a task, a new note or a new task, a picture then in a new note the task links to). A screenshot is a picture clip like any other. The text a phone share writes is `share.ts`'s (`server/test/clip.test.js` checks). Shapes: `packages/core/src/clip.ts`; contract: `extension/AGENTS.md`. A summary is written one way (`lib/clip.js` `summarise`), for a clip and for a note link's Summary button (`summary.pb.js`, `web/src/editor/link-tools.ts`) | ⭐ the extension's contract |
| `packages/core/src/share.ts` + `share-target.ts` + `share-stash.ts` | What a share from another app becomes: Android's web share-target form as a `Shared` (`fromPost`: the link is found in `text`), the share as a clip, the note, the assistant's message; the manifest's `share_target` path and cache names; the stash that carries the post from the service worker (`web/sw/sw.ts`) to the page (`web/src/components/share-page.tsx`). The phone's intent is `fromIntent`, same file | ⭐ shares |
| `packages/core/src/lens.ts` | Lenses, the global filter: the `Lens` type and its defensive reader, `inLens` (any of its tags, or any item when it has none, and none of its `exclude`, for notes and tasks), the tag a new item inherits (the lens's first), the `filter` text the assistant is sent; calls: `pocketbase.ts` `lenses`. Definitions are the server's `lenses` collection; which lens is on is each device's own (web: `hooks/lens.ts`, localStorage; phone: `store/prefs.ts`) | ⭐ lenses |
| `server/pb_hooks/tags.pb.js` + `lib/tags.js` | Tag descriptions (the route returns one; the hourly job saves one every 10 new notes); client calls: `packages/core/src/tags.ts` | |
| `server/pb_hooks/lib/notes.js` | The server's copy of the note format for hooks that write notes; mirrors `packages/core/src/notes.ts` (`server/test/notes.test.js` checks they agree) | |
| `server/pb_hooks/lib/jev.js`, `lib/llm.js`, `lib/keys.js`, `lib/env.js` | Provider endpoints, pinned model and key path; one key reader. Images go to JEV with its opt-in header; prompts are `lib/clip.js` `noteRequest` and `summaryRequest`, `lib/tags.js` `request` | |
| `server/agent/` | The chat agent. Prompt, memory, notes context (and the assistant's `<screen>`, `src/assistant.ts`, with the app's UI tools) and chat saving: `src/agent.ts`; the web-taint guard: `src/guard.ts`; between steps, earlier turns' long tool results cut to a stub and `update_memory` withdrawn once the turn is tainted: `src/loop.ts`; a note's PDFs as text (the open note's first pages in the context, `read_attachment` for the rest; reading one taints like the web; a tile's picture of the first page, `GET /agent/pdf-thumb`): `src/pdfs.ts`; a note's pictures shown to the model (`read_image`, tainting; the chat keeps only which one): `src/images.ts`; a link's article (`read_page`, `src/reader.ts` over the guarded fetch, tainting); tools, every write a rev compare-and-swap: `src/tools.ts`, `src/notes.ts` (search_notes: words fused with meaning, `src/semantic.ts`, a local embedding model, vectors in the `agent_data` volume), `src/todoTools.ts` over `src/todo.ts`. The same note and task tools over MCP for other harnesses (`TEF_NOTES_MCP=1`; no cards, every write tainted): `src/mcp.ts` | ⭐ the agent contract |
| `packages/core/src/push.ts` + `server/agent/src/push.ts`, `reminders.ts` | Web Push task reminders: the contract (`PushKey`, `PushSubscribeBody`, `PushPayload`, readers) and the routes under `/agent/push`; every minute the agent pushes the tasks whose `when` + `remind` has come (`remindAt`, the phone's rule), once each (`push_sent`). Needs the `push` VAPID key and `TEF_NOTES_VAPID_SUBJECT`, else off | ⭐ push |
| `packages/core/src/assistant.ts` | The always-on assistant's contract: `AssistantContext` (view, open note, task, selection, filter) a client sends as `context` with every chat request, `contextOf` (the defensive reader), and the UI tools the client does itself (`open_note`, `open_task`, `go_view`; no server `execute`, answered with `UiOutput`); `server/agent/src/assistant.ts` holds their schemas to these types | ⭐ the assistant contract |
| `packages/core/src/widgets.ts` | The widgets the agent's `show_*` tools return (`day`, `week`, `review`, `quote`, `link`, `lens`) and `widgetOf`, their defensive reader; the tools are `server/agent/src/widgetTools.ts` over `plan.ts`. `ask_choice` (buttons, answered by the owner) is the assistant contract's | ⭐ widgets |
| `server/pb_hooks/link-preview.pb.js` + `lib/link-preview.js` | Link previews; the SSRF guard lives in the lib | ⭐ |
| `packages/core/src/reader.ts` | Reader view's contract: `Article`, the defensive reader. Route `server/agent/src/reader.ts` (Defuddle, `useAsync: false` so its extractors never fetch past the guard) over `pb_hooks/reader.pb.js`, which fetches the page through `lib/link-preview.js`'s guard | ⭐ |
| `packages/core/src/find.ts` | Search by asking: when the search box finds nothing, `POST /agent/find` (`server/agent/src/find.ts`) runs a short loop on the default model with only `search_notes`, `read_note`, `list_tasks`, and answers notes and tasks with why each fits; no chat saved, nothing written, made-up paths and ids dropped. Web: the palette's "Search with the assistant"; phone: the same row in Home's search drawer (`mobile/src/ui/search.tsx`) | |
| `packages/core/src/pocketbase.ts` | The client every writer uses (phone, web, CLI, agent); `noteColumns` | ⭐ |
| `packages/core/src/notes.ts` | Frontmatter parse and serialize, ids, 3-way merge | ⭐ note format in code |
| `packages/core/src/agent.ts` | Card shapes (`NoteCard`, `TaskCard`) and builders, the model pick, a write's diff and flags, the confirm reasons | ⭐ |
| `packages/core/src/theme.ts` | The themes (`THEMES`): the phone's `src/theme.css`, the web app's CSS variables and `app.config.ts` colours are generated from it | ⭐ colours |
| `web/src/services/` | The web app's transport (axios), errors mapped to the core's `Conflict` | |
| `mobile/AGENTS.md` | The app's architecture and sync contract | |
| `extension/AGENTS.md` | The clipper's clip contract, its build and the signed CRX (`scripts/crx.ts`) | |
| `site/README.md` | The public marketing page: a static Vite build deployed on its own (any static host, or its Dockerfile from the repo root); palette and fonts from `@/core/theme` and `mobile/assets`; the app screens drawn in code (`src/components/mock/`), never screenshots | |

## Working with notes from the laptop

`tefnotes --help`. Notes are the user's: append or edit what they ask; don't reorganise unasked.
`tefnotes export <dir>` writes every note and its attachments out as files. A note's "Ask about this" hands it to the agent as
a draft message naming it by path (`packages/core/src/handoff.ts`, no request field: the agent reads it with its own tools).

- `cat` prints the `rev` on stderr; `put` and `rm` take it back and refuse if the note moved since. That
  refusal is the point: re-read and redo the change, never retry with the newer rev blindly.
- `edit` merges an edit made meanwhile (same merge as the phone) and refuses on overlap, leaving your
  text in a temp file.
- `grep` is the server's `LIKE`: case-insensitive, but Greek tonos must match. The phone's search folds them.

## Commands

Setup and build steps live in each module's README. The ones an agent reaches for:

```sh
cd server && docker compose up -d --build              # the server; migrations and hooks apply on start
cd server && bun test                                  # hooks and the agent
cd packages/core && bun test && bun run typecheck      # the shared core
cd web && bun install && bun run build                 # tsc + vite; `bun run lint` is oxlint; `bun test`
cd web && bun run build:editor                         # the phone's editor page -> mobile/src/ui/editor-html.ts (generated, gitignored)
cd web && bun run build:pdf                            # the phone's PDF viewer page -> mobile/src/ui/pdf-html.ts (generated, gitignored)
cd cli && bun install && bun run typecheck             # the CLI
cd extension && bun install && bun run build           # -> extension/dist; `bun run typecheck`, `bun run lint`
cd server/agent && bun install && bun test && bun run typecheck
cd mobile && npx pnpm@11 install && pnpm typecheck && pnpm test
```

## Ownership

| Module | Owns | Never |
|---|---|---|
| `server/` | Schema, rules, the rev contract; the auto-tagger; the clip routes (re-read and rev-bumped in one transaction; a picture's attachment removed again if that fails); the chat agent: the model keys, the loop, its tools over notes, tasks and their confirm cards (AI SDK tool approvals), the chats | Business logic beyond that: clients own merging, and tag acceptance is a client edit. Writing text of its own outside a chat: JEV only decides, and DeepSeek only tidies the user's own note on a clip, plus a summary when asked for that clip and a tag's description when asked (returned, not saved) or every 10 new notes carrying it (saved, hourly job). A note write the user didn't confirm, unless they turned the cards off and the chat hasn't read the web |
| `packages/core/` | The pure, dependency-free code every client imports: note format, merge, PocketBase client, task logic, agent card shapes, theme | Dependencies, I/O of its own, anything platform-specific |
| `mobile/` | Offline cache, merge, conflict UI, the assistant over the server's agent (the Ask tab) | Talking to anything but the server; holding a model key |
| `cli/` | Terminal access for the user and coding agents: notes and tasks | A second copy of client logic: it imports `@/core/*` |
| `web/` | The laptop's UI: shadcn animated by Animate UI's npm package (`web/README.md` "Motion"), TanStack Query, axios services, the assistant dock over the server's agent; served by PocketBase from `pb_public` | Talking to anything but the server. Note format, merge, ids, the Ask wording, colours of its own: all from `@/core/*`; a model key |
| `extension/` | The browser's "Save to TEF Notes": reads the page, or fetches the picture and downscales it as the phone does, shows the server's suggestions, takes an optional note, saves where the user picks | Filing logic (the server's), any key or sign-in, colours of its own: all from `@/core/theme` |
| `site/` | The public page: copy, device frames, the app screens it draws | Talking to any server; a palette, font or icon set of its own: all from `@/core/theme`, `mobile/assets/` and lucide |

## Footguns that actually bit

- Hooks and migrations are baked into the image (`server/Dockerfile`), never bind-mounted: PocketBase restarts on any
  hook change and applies every pending migration, so a mounted checkout once deployed a saved migration to the only copy
  of the data unreviewed (2026-10-31). They reach the server with `up --build` only.
- The link-preview route fetches arbitrary URLs from a host on a private network: every hop (redirects are followed by
  hand) must pass `lib/link-preview.js`'s public-address check, and the address it checked is pinned for the connection.
  Never switch it to `$http.send` (follows redirects unseen) or loosen the check. A PocketBase handler runs in its own VM:
  it sees none of its file's top-level scope, so shared code is `require`d from `lib/` (testable: `cd server && bun test`).
  The image installs `curl` for it.
- An async run that never awaits finishes *before* the line assigning its promise does: a `finally` that
  clears `running` inside it clears nothing, and every later call returns early, silently. Clear it in
  `.finally()` on the stored promise (`mobile/src/store/attachments.ts`).
- The phone's editor and PDF viewer pages are built by `web/` into `mobile/src/ui/editor-html.ts` and `pdf-html.ts`
  (generated, gitignored: ~930 KB and ~2 MB). A fresh checkout has none: `mobile`'s `start`, `android` and `typecheck`
  build them first; EAS cloud builds would need the same step. Bridges: `packages/core/src/editor-bridge.ts`, `pdf-bridge.ts`.
- `components/ui/` in `web/` is shadcn's output: add with `bunx --bun shadcn@latest add <name>` (then `bunx @animate-ui/cli@latest animate <name>` for the animated primitive), never hand-edit. Its
  three `only-export-components` lint warnings are shadcn's, not ours.
- Tailwind's CSS `@import` can't see Vite virtual modules: the generated palette is imported from `web/src/main.tsx`.
- `pnpm` 10 rewrites `mobile/pnpm-lock.yaml` into the old patch format and then refuses `--frozen-lockfile`.
  The lockfile is pnpm 11's: `npx pnpm@11 install`.

## Invariants

- Never bind PocketBase or the agent beyond loopback: a reverse proxy on a private network is the only way in. There is no
  sign-in (`server/pb_migrations/1792400000_open.js`), so anything that reaches the port can read, write and delete every
  note. Never expose it publicly (`SECURITY.md`).
- Never write a note or task without the `rev` it was based on; the hook refuses it, and so must clients.
- Never `docker compose down -v`, delete `server/pb_data/` or prune its volume without asking: it is the only copy, and
  nothing backs it up.
- Never commit `pb_data/`, `.env`, key files or a signing `.pem`.
- A schema change is a new file in `server/pb_migrations/`, never an edit to an applied one. Deploy and verify steps:
  `server/README.md`.
