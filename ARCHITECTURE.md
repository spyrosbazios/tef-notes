# Architecture

<!-- reviewed: 2026-11-10 -->

How TEF Notes fits together: the pieces, the note format, the write contract, tasks, links, and the server's jobs. For setup see
[README.md](README.md) and the module READMEs.

## The pieces

```
 Web app     ─┐                          ┌─ PocketBase (collections, rev hook, jobs, routes) ─ pb_data/
 CLI         ─┼─ reverse proxy ─ HTTP ───┤        also serves the web app and the extension
 Clipper     ─┘  (private network)       └─ agent sidecar (bun): /agent/chat, /agent/models, /agent/transcribe, /agent/talk
                                          └─ stt (python): speech to text, reached by the agent only
```

- `server/`: PocketBase with JS hooks (`pb_hooks/`) and migrations (`pb_migrations/`). It holds the data, enforces the
  write contract and runs the server-side jobs below. `server/agent/` is the chat agent, a separate bun process because
  PocketBase hooks cannot stream. `server/stt/` is voice input: a Python service running Parakeet on the CPU, on the
  compose network only, that the agent's `/agent/transcribe` passes a clip to (`server/README.md`, "Voice input").
- `packages/core/`: dependency-free TypeScript shared by the web app, CLI, extension and agent, imported as
  `@/core/*`. It holds the note format, the merge, the PocketBase client, task logic, agent card shapes and the theme
  palettes. The server's hooks are plain JS and cannot import it, so `server/pb_hooks/lib/notes.js` is a small copy of
  the note format that a test (`server/test/notes.test.js`) checks against `packages/core/src/notes.ts`.
- Clients own merging. The server stays thin: schema, rules, the `rev` contract and a few jobs.
- There is no sign-in; see [SECURITY.md](SECURITY.md).

## Note file format

A note is one markdown file, stored whole in the record's `text`. Its record is keyed by `path`
(`notes/YYYYMMDD-<slug>.md`; the filename is the note's stable id, and a note's path never changes). The record
`agent/memory.md` is not a note: it is the chat agent's memory of you (who you are, how you keep notes), rewritten by
the agent without asking, under 6000 characters.

```markdown
---
title: Garage door codes
created: 2026-10-05
pinned: false
color: yellow
tags: [home]
---
Body in GitHub-flavored markdown: links, `- [ ]` checkboxes, bullets, tables, code, images.
```

- `title` and `created` are always present. `pinned`, `archived`, `color` and `tags` appear only when set. Notes have no place: only tasks do (`where`, below).
- `archived: true` puts a note away: out of the notes lists (the list's archive button shows them, `?archived=1`), the agent's
  notes index and a clip's choice of where to file, but still found by search, its links and the agent's tools
  (`list_notes "archived"`). Archiving unpins it (`archivePatch`, `packages/core/src/bulk.ts`).
- There is no `updated` field on purpose: both sides would touch it on every edit and the line merge would conflict every
  time. The server's own `updated` column tracks it.
- `color` is one of `yellow pink blue green purple gray`: the note card's tint in the list.
- A photo is a record in `attachments` (note id and name). The body shows it as
  `![caption](../attachments/<note-id>/<name>.jpg)`, downscaled by the client (max 1600 px, JPEG).
- A PDF is a record in the same collection, kept as it is (max 25 MB), named by the slug of its filename. The body links
  it as `[original name.pdf](../attachments/<note-id>/<name>.pdf)`. The editors draw that link as a file chip and open
  the PDF in a viewer (a pdf.js page).
- A drawing is an Excalidraw scene, `<name>.excalidraw` (JSON), stored with a `<name>.png` preview beside it. The body
  links only the scene, as a PDF is linked. The web app opens it in Excalidraw on a layer over the note, the assistant's
  dock beside it (a lazy chunk; a save replaces both files, a new drawing's first save links it into the note). The agent draws on the open canvas with the `draw` UI tool: its shapes land unsaved and
  undoable, and the owner's Save is what writes them, so the server never writes a scene (`packages/core/src/drawing.ts`).
  Each `draw` answers with a picture of the drawing after it, which the model looks at to fix what is off; a saved chat
  keeps no picture. A drawing's PNG is also a tile picture of its note, like a photo.
- The `title`, `day`, flag and `tags` columns are copies of the frontmatter, written by the client beside `text`. Edit the
  text; never set those columns alone (`noteColumns` in `packages/core/src/pocketbase.ts` builds them for every writer).
- `autotagged` and `tagged` belong to the server's auto-tagger and are never written by a client. The auto-tagger suggests nothing: every tag it judges likelier than not (p >= 0.5) it adds
  itself, and a wrong one is removed by hand. `autotagged` holds every name it ever added to the note, which it never
  adds again, so a tag you removed by hand stays removed. `tagged` is `"<rev>:<hash of the tag definitions>"`, the state
  the note was last evaluated at. The server's tag additions are ordinary `rev` bumps (the 3-way merge absorbs them); a
  verdict with nothing to add (`tagged` alone) changes neither `rev` nor `updated`, nor reaches realtime.
- `tainted` belongs to the chat agent: set in the same write when it writes a note with web text in view, never cleared,
  never sent by a client. A tainted note read back counts as reading the web, so that chat's next write asks first.
- `kind` says what the note is: `note`, the only kind today; a select that grows as kinds are added
  (`server/pb_migrations/1793300000_note_kind.js`). It is set when the note is made and never changes (`notes.pb.js`: a
  create without one is a `note`). It is the only test of what a note is: nothing reads a kind out of a path. Clients get it
  with every listing (`Listed`, `Remote`, `Card` in `packages/core/src/pocketbase.ts`; `noteKindOf`). The removed screenshot
  captures' `capture` is still in old data and reads as `note`.
- A `- [ ]` box in a note is only a box, ticked in the note's editor. Tasks are
  records (below), never lines in a note.

## Tasks

Things-style to-dos, records of their own (`tasks`; schema in
`server/pb_migrations/1792900000_todo.js`, shape in code in `packages/core/src/todo.ts`).

- `tasks`: `title`, `notes`, `checklist` (`[{id, text, done}]`, ids unique within the task), `when`, `evening`,
  `due`, `every`, `remind`, `done`, `order`, `tags`, `where` (its place, `packages/core/src/places.ts` `Place`: name, address, lat/lng, place_id, or null; picked over OpenStreetMap through the agent, or typed by name; shown with its map, Directions and Open in Maps; one value
  in a merge). The notes a task is about are links (below), not a field.
  Unset text is `""`.
- Tags (`server/pb_migrations/1793500000_task_tags.js`): `tags` is the one copy of a task's tag names (a task has no
  frontmatter), an ordinary `rev` write; two edits merge as a set (`mergeRecord`). The server never tags a saved task: the
  new-task forms (`web/src/components/quick-add.tsx`) ask the guess route as the title and notes are typed
  (`tagGuesser` in `packages/core/src/tags.ts`, 0.8 s debounce) and put its answer on the draft; a tag taken off there is
  not guessed again. What the form holds on save is the task's.
- Values: days are `YYYY-MM-DD`, and there is no "today" value: a past `when` is Today. `evening` (This Evening) only goes
  with `when`. `remind` is `HH:MM` on the `when` day. `every` is `Nd Nw Nm Ny` fixed (next from
  the scheduled day, skipping to after today), `+Nd` and so on from the day it was done, or `mon,thu` weekdays. A
  month's last day stays the last day (Jan 31, Feb 28, Mar 31).
- `tainted` is the chat agent's, as on notes: set in the same write when it writes a task with web text in
  view, never cleared, never sent by a client (`taskOf` drops it, so a client's PATCH leaves it).
- A client names a new record itself (`recordId`, 15 characters of `[a-z0-9]`), so a record made
  offline already has its id. A create whose id is taken is a `Conflict` (the same upload landed before).
- Deleting a note deletes its attachments
  (`server/pb_hooks/notes.pb.js`) and its links (cascade); no task changes.
- Ticking a repeating task marks it done without `every` and makes its next round a new record (`complete`), linked to
  what the done one was linked to (`linksForNextRound` in `packages/core/src/record-links.ts`).
- Transport: `packages/core/src/pocketbase.ts` (`tasks`: `revs`, `list`, `get`, `getMany`, `create`,
  `update`, `remove`).

## Lenses

A lens (`packages/core/src/lens.ts`) is a name and a set of tags: a global filter. While one is on, a note or task is shown
only if it carries any of its tags (`inLens`, tonos and case ignored) in every list, count, search and tag view, and a note
or task made meanwhile gets the lens's first tag (`inheritTags`). A record opened by its address stays reachable whatever the
lens says; only lists are narrowed.

- The definitions are the `lenses` collection (`server/pb_migrations/1793600000_lenses.js`: `name`, unique ignoring case, and
  `tags` as JSON), so every device has the same ones. Like the `tags` definitions it has open rules and no `rev`: a lens is
  edited whole and the last save wins. Calls: `packages/core/src/pocketbase.ts` `lenses`.
- Which lens is on is a preference every device shares (`packages/core/src/prefs.ts` `lens`), and none is the unfiltered app. A lens deleted elsewhere is none (`activeLens`).
  The web switcher is at the bottom of the rail; on a phone it is on Home, and the lens filters every tab.
- The assistant is told: the web app sends the lens as the request context's `filter` (`lens: Work (tags: work, clients)`,
  `contextFilter`), and the agent's instructions say to scope what it lists, counts and summarises to those tags unless asked
  otherwise (`server/agent/src/systemPrompt.ts`). The scoping is the model's, not a server filter.

## Links

One `links` record per relation between two records, `from` → `to` with a `role` (schema:
`server/pb_migrations/1793300001_links.js`; shape in code: `packages/core/src/record-links.ts`; calls:
`packages/core/src/pocketbase.ts` `links`). It replaced the single `tasks.note`: a task about several notes, what links to a
note (its backlinks), a task made from a clipped picture (about the new note holding it).

- Ends are typed relations, one column per kind of record on each side: `fromNote` `fromTask`, `toNote` `toTask` (the
  collection also has `fromShot` and `toShot`, from the removed screenshot captures: never set, refused by the hook). Exactly
  one of each side is set, and a record is never linked to itself (`server/pb_hooks/links.pb.js`,
  on every save). Typed rather than a free `(type, id)` pair so that PocketBase checks an end exists, deletes the link when
  either end is deleted (`cascadeDelete`) and can expand them.
- `role`: `about` (from is about to: a task about a note, a task made from a clipped picture) or `source` (from was made
  from to: a note or task made from another note). One link per (from, to, role): a unique index over every end column and the role
  (empty relations are stored as `""`).
- A link is never edited, only made or deleted (no update rule), and carries no `rev`: it holds nothing to merge, and making
  or removing one changes neither end, so neither end's `rev` moves. Both calls are idempotent: a create whose id, or whose
  (from, to, role), the server has already is the link meant (`links.add` returns the server's copy); a delete of one gone
  is done. A client names a new link itself (`recordId`), and syncs links as a set of ids: an id never changes what it
  points at.
- A client that predates links may still send a task's `note`: PocketBase ignores a body field the collection does not
  have, so the write lands without it.

## The write contract

Every write to a note or task carries the `rev` it was based on. Links are outside it (above).

- `server/pb_hooks/rev.pb.js` (logic in `lib/rev.js`) is a compare-and-swap: a write whose `rev` is not the record's
  current one is refused, and a successful write bumps it.
- A client that is refused re-reads and merges, then retries with the new `rev`. Notes use a line-level 3-way merge
  against the version the client last had (`packages/core/src/notes.ts`; it refuses on overlap). Tasks merge
  field by field (`mergeRecord` in `packages/core/src/todo.ts`): each side's changes are kept, a checklist is merged by
  item id, and a field both sides changed goes to the side doing the merging, there being one user. A task's tags merge as a set (an addition on either side is
  kept, a removal on either side goes). A task's exclusion (`evening` needs `when`) is mended after a merge (`normalizeTask`).
- The server's own writers (auto-tagger, clip, agent) follow the same rule: re-read inside a transaction and drop the
  write if `rev` moved.

## The chat agent

`server/agent/` is a bun sidecar, loopback-only like PocketBase; the reverse proxy maps `/agent` on your origin to it.

- `POST /agent/chat` streams an [AI SDK](https://ai-sdk.dev) UI message stream (`useChat` with `DefaultChatTransport` on
  the clients). `GET /agent/models` lists the provider's models and says whether the server holds a key (`available`).
- The prompt, the notes context, the memory and chat saving are in `src/agent.ts`. Its tools work on PocketBase through
  the same `rev` compare-and-swap: `src/tools.ts` and `src/notes.ts` for notes, `src/todoTools.ts` over `src/todo.ts` for
  tasks.
- `search_notes` finds a note by its words and by meaning (`src/semantic.ts`): a small multilingual embedding model
  (bekko-embedding-v1-a8m, MIT) runs in the agent on the CPU, so a Greek question finds an English note; no key, nothing
  leaves the host. Each note is cut into chunks and embedded when its text changes; the vectors and the model live in the
  agent's `agent_data` volume (derived: deleting it costs one re-embed). The two rankings are fused by reciprocal rank.
  A note's PDFs are embedded with it (first 50 pages; a scanned one has no text). A match inside a PDF returns only its
  name, never its text: reading it is `read_attachment`, which taints like the web.
- Writes ask first: each write is a confirm card (AI SDK tool approval) unless you turned the cards off. The chat draws
  notes and tasks as cards: every write's result carries its `card`, and `show_items` is how the agent puts
  what it found in front of you. Card shapes (`NoteCard`, `TaskCard`) and builders are in
  `packages/core/src/agent.ts`.
- Web-taint guard: once a chat has read the web (a search result, a fetched page, or a note marked `tainted`), the
  next write asks first even with cards off, and what it writes is marked `tainted`. See `src/guard.ts`.
- Always-on assistant: a client that stays with you (the web's docked panel, its Ask tab on a phone) sends the page it is on as
  `context` with each message (`packages/core/src/assistant.ts`). The agent reads it as the last part of the newest message's
  `<context>` (never the instructions), resolves "this note" from it, and gets UI tools (`open_note`, `open_task`,
  `go_view`) that the client does itself: no server `execute`, no confirm card, answered through `addToolOutput`.
- A chat is a record in `chats`: a client creates it empty, and the agent writes `messages`, `title` and `model` as the
  reply streams and when it ends.
- Providers: one model provider per server, `TEF_NOTES_PROVIDER` (DeepSeek by default; `server/agent/src/models.ts`, with
  `server/pb_hooks/lib/llm.js` its plain-HTTP copy for the hooks); `exa` powers web search. Without the provider's key a chat is refused; without
  `exa` the web tools are left out of the prompt.
- Places (`src/places.ts`, `src/placeTools.ts`): `GET /agent/places/suggest`, `place` and `map` are a task's place search
  over OpenStreetMap's free services, no key: Photon for suggestions (each a whole place) and the assistant's `find_place`
  (taints the chat like the web, a business names itself), Nominatim for a place by its OSM id, and OSM's tiles composed
  into an SVG in the owner's theme (tiles cached in memory). Their policies ask for an identifying User-Agent, light use
  and the credit shown. `set_place` writes a task's `where` from the details by `place_id`, or
  a name alone.
- Voice input (`src/transcribe.ts`): `POST /agent/transcribe?keep=S` takes a clip as raw mono 16 kHz float32 samples and
  answers its text from the `stt` service (`TEF_NOTES_STT`); `/agent/transcribe/warm` loads the model as recording
  starts; `keep` is how long the model stays loaded once idle, the owner's setting (`packages/core/src/prefs.ts`
  `voice.keep`). Nothing is stored. Contract: `packages/core/src/voice.ts`; without `TEF_NOTES_STT` both answer 404.
- Talk (`src/talk.ts`): a spoken conversation over one WebSocket, `/agent/talk`. The agent holds a Gemini Live session
  and runs the chat's own tools, pre-write checks, confirm cards and taint rules for it; the app sends the microphone
  and plays the voice. The speech model's tool list is fixed when its session starts, so what a chat withdraws once it
  has read outside text is refused in the handler instead. Saved to `chats` like a chat; no audio is stored. Contract:
  `packages/core/src/talk.ts`; without the `gemini` key `GET /agent/talk` answers 404 (`server/README.md`, "Talk").

## Server jobs and routes

All custom routes live under `/api/tefnotes/` (PocketBase serves its own API beside them). Hooks run in their own
JS VM: a handler sees none of its file's top-level scope, so shared code is `require`d from `server/pb_hooks/lib/`.

| Route | Hook | Does |
|---|---|---|
| `POST /api/tefnotes/clip/suggest` | `clip.pb.js` | JEV ranks up to 4 notes and open tasks a page or picture fits; writes nothing |
| `POST /api/tefnotes/clip/tags` | `clip.pb.js` | JEV scores every defined tag for a page and preselects the likely ones; writes nothing |
| `POST /api/tefnotes/clip` | `clip.pb.js` | Saves the clip to the chosen target; no JEV |
| `GET /api/tefnotes/clip/image` | `clip.pb.js` | Fetches a public picture for the extension, through the link-preview guard |
| `POST /api/tefnotes/tags/guess` | `autotag.pb.js` | JEV's tags for a task being typed (`{title, notes}` → `{tags}`); writes nothing |
| `POST /api/tefnotes/tags/describe` | `tags.pb.js` | The model drafts a tag's description; returned, never saved (the hourly job below saves its own) |
| `GET /api/tefnotes/link-preview?url=` | `link-preview.pb.js` | Page title, description and picture for link cards; cached in `link_previews` |
| `POST /agent/chat`, `GET /agent/models`, `GET /agent/search` | `server/agent/` | The chat agent and its search by meaning (a separate process) |

**Auto-tagger** (`autotag.pb.js`, `lib/autotag.js`). A cron that runs every minute asks JEV about notes not yet
evaluated at their current `rev` and tag definitions, looking at up to 3 of a note's photos (`lib/images.js`). Every tag it
judges likelier than not (p >= 0.5) is written into the note's frontmatter as a `rev`-bumping compare-and-swap (re-read in
a transaction, dropped if `rev` moved); nothing is only suggested. A new or edited tag definition re-evaluates every note,
up to 50 a minute. Tasks are tagged only while typed (the guess route, Tasks above). Without a `typesafe` key it tags nothing.

**Clip flow** (`clip.pb.js`, `lib/clip.js`). Two steps. `suggest` takes the page's URL, title and text, or a picture, and
your optional note as context, and returns up to 4 candidates, each `{kind: "note" | "task", ...}`, plus the page's own
one-line description. `clip` then takes a `target`: `{kind: "note", path}` (appended to the note), `{kind: "task", id}`
(added to the task's `notes`; a picture only as an image line to its address, a task having no attachments),
`{kind: "new"}` or `{kind: "newtask"}` (a new task with the clip's text as its `notes`; a picture then goes into a new note
of the whole clip, which the task is `about`, all in one transaction). A screenshot is no feature of its own: it is a
picture clip like any other. The picture is stored as an attachment and embedded as any photo is. Your own note is
written up by the model, which tidies and adds nothing. Only when you ticked "Add a summary" (`summary: true`, off by
default, remembered by each client) does the model add a short summary under the link or picture, from the page's text
(fetched through the link-preview guard for a link that came with none; a picture's only from the words it came with).
The answer's `summary` is `"added"`, `"skipped"` or `"failed"`, and the clip is saved in every case. The note edit is
re-read and `rev`-bumped in one transaction; a picture's attachment is removed again if that fails. Shapes are in `packages/core/src/clip.ts`. Without a
`typesafe` key `suggest` returns nothing (`pick: "new"`); without the model provider's key a note goes in as typed.

**Link previews** (`link-preview.pb.js`, `lib/link-preview.js`). Link cards are bare-URL paragraphs only: the markdown
never changes. The route fetches arbitrary URLs from a host on your private network, so it is an SSRF risk, and the guard
is strict: every hop (redirects are followed by hand) must pass the public-address check, and the address it checked
is pinned for the connection. The image installs `curl` for this. Never switch it to PocketBase's `$http.send`, which
follows redirects unseen, or loosen the check.

**Tag descriptions** (`tags.pb.js`, `lib/tags.js`). `{tag}` or `{all: true}`; the model writes a description (up to 400
characters, the auto-tagger's hint) from up to 12 notes that carry the tag. Clients save it with the tag. An hourly job
(`tags.pb.js`) rewrites and saves a defined tag's description itself each time 10 more notes carry it than when it was
last written (`tags.described`), replacing a hand-written one.

**Where AI is allowed to write.** JEV only decides (tags, suggestions). The writing model (the server's provider) only tidies your own note on a clip,
writes a summary when you asked, and drafts a tag description when you asked (returned, not saved) or when 10 more notes carry the tag (saved). Only the chat agent
writes text of its own, and only with your confirmation.

## Web app

`web/` is built by the server image into `pb_public`, so the web app and the API share an origin (no CORS, one URL to
configure). It uses shadcn, TanStack Query and axios services (`web/src/services/`), with errors mapped to the core's
`Conflict`. On a phone it is the installed PWA, in its own layout below `md`.

Colours live in one place, `packages/core/src/theme.ts` (`THEMES`: sixteen themes, nine dark and seven light, each a palette,
tints and note colours, and `ACCENTS`). The web app, the site and the extension get the
default theme as `--tf-*` CSS variables from one Vite plugin, `packages/core/vite.ts`. The web app lets the
user pick a theme and an accent (it re-sets the variables at runtime); the site and the extension show the
default. The brand mark is `packages/core/src/brand.ts`, generated from `assets/mark.svg` by `assets/icons.ts`,
and every client draws that path.

## Deploys

One `docker compose up -d --build` from `server/` deploys everything:

- The image builds `web/` into `pb_public` and `extension/` into a signed `pb_public/extension/` once its signing key
  exists, then adds PocketBase. The agent sidecar has its own image (same repo-root build context, its own allowlist).
- Hooks and migrations are baked into the image, never bind-mounted. PocketBase restarts on a hook change and applies
  every pending migration, so a mounted checkout would deploy whatever was saved, unreviewed, to your only copy of the
  data. They reach the server with `up --build` only.
- A schema change is a new file in `pb_migrations/`, never an edit to an applied one.
- Provider keys are bind-mounted read-only and re-read on every use; a new key needs no restart.

Per-module setup and verification: [server/README.md](server/README.md).
