# tefnotes mobile — agent notes

<!-- reviewed: 2026-11-07 -->

The Android app. Read the root `AGENTS.md` first for how the server, the CLI, the web app and the app fit together, and
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) for the note format, the `rev` contract and the agent's design (not repeated
here). Building and running is `README.md`. This file is the app's internal map and the contracts its parts hold each
other to. Android only: widgets, Live Update, a foreground service, `arm64-v8a`.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any
code that touches an Expo or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt, an index of all Expo docs with corrections to common LLM
   misconceptions. Follow its links to the specific page you need; never answer from memory.

## Rules

- Add dependencies with `npx expo install <package>` (resolves SDK-compatible versions), not `pnpm add`. The package
  manager is pnpm 11 (`npx pnpm@11 ...`).
- `android/` is generated (Continuous Native Generation): never create or edit it. Native behaviour is `app.config.ts` and
  `plugins/`.
- Expo Go has only its bundled native modules. This app needs a development build (`npx pnpm@11 android`).
- Prefer Expo's own modules over third-party ones when one fits.
- Navigation is Expo Router: routes live in `src/app/`, every file there is a screen. Non-route code stays outside it.
- Before declaring a task done: `pnpm lint` and `pnpm typecheck` (the commands are in `README.md`). Never `npx tsc
  --noEmit` alone: it fails on a tree whose generated pages have not been built, and `typecheck` builds them.

## APK builds on the low-resource server

- Prefer repacking a compatible existing APK for JavaScript/TypeScript, style and asset changes instead of doing a full
  native build. Read the current [Expo repack docs](https://docs.expo.dev/build-reference/repack/) before using the tool;
  compare native fingerprints against the source APK's build and preserve the signing key so the APK can update the
  installed app. If native compatibility cannot be established, use a full build. Repacking has not yet been validated
  or benchmarked for this app; do not assume it works until an installed repacked APK has been checked.
- Native dependency, Kotlin/local-module, config-plugin or Expo SDK changes require a full native build. Gradle remains
  the native build tool; repacking only avoids repeating native compilation when the native side is unchanged.
- For full builds, preserve Gradle caches and generated build outputs; avoid routine `clean` or `prebuild --clean`.
  Start with `./gradlew assembleRelease --build-cache --max-workers=2 --no-parallel` in `mobile/android` to limit resource
  pressure on the server, then tune from measurements. Fewer workers are a memory tradeoff, not a guaranteed speedup.
  The app already targets only `arm64-v8a`. Persist any build configuration through `app.config.ts` or config plugins,
  never by editing generated `android/` files. Build the generated pages before bundling, as described in `README.md`.

## Layout

Where each thing lives, so you find it without grepping.

- `src/app/`: Expo Router screens.
  - `(tabs)/home.tsx`, the first tab, the day at a glance and every note, as the web's Home: one header row (the app's mark, which is the lens control, and a search button in the corner), the days (`ui/days.tsx` over `@/core/planner`, the web's month planner as a strip of days scrolled
    sideways past one fixed slot: the day in the slot is the day the box shows, dragged or tapped there; a long press adds a
    task that day), the task box under it (Today, Inbox and Upcoming as
    quiet words over one list at a fixed height that scrolls inside the page, its own tag filter, a + opening `AddSheet`), then all
    notes as `ui/note-tile.tsx` tiles, a page at a time, under a header with the tag filter (`TagFilter`, `ui/notes-header.tsx`: a button opening a
    multi-select tag filter sheet), the sort (`@/core/note-sort`, the `notesSort` pref), the grouped-by-tag view (`ui/note-groups.tsx` over
    `@/core/note-groups`; prefs `notesTags`, `notesView`, `collapsedTags`) and a + for a new note, styled as the task box's. No Notes tab, no
    sync or assistant button: Ask and Settings are tabs, sync state is in Settings. The pieces: `ui/home.tsx`.
  - Search is Home's drawer (`ui/search.tsx` `SearchDrawer`, no tab or route since 2026-11-06): the header's search button opens a field
    under the header and the results take the page's place: notes (FTS5, `#tag` chips and prefixes), tasks, tags and the screens to
    jump to, inside the lens that is on; a long press on a note opens its actions; back or the cross closes it.
  - `(tabs)/today.tsx`, the Tasks tab: Inbox, Today, Upcoming and Logbook. It is
    opened at a list by `openTaskList` in `ui/tasks.tsx`, its `list` param taken and cleared.
  - `note/[id].tsx`; `task/[id].tsx` (a task as a card, then its linked notes); `(tabs)/ask.tsx` (the assistant: one chat, its own tab); `chats.tsx` (past chats; picking one reopens it on Ask); `(tabs)/settings.tsx` (the last tab); `photos.tsx` (the photo viewer, `ui/photos.tsx`); `pdf.tsx` (a note's PDF);
    `widget/[action].tsx` (below).
  - `share.tsx`: Android's Share sheet lands here (`+native-intent.ts` routes the deep link). The clip flow for a link, text
    or one photo suggests the notes and open tasks it fits, takes an optional note and files it into one, as a new note or as a
    new task; otherwise it becomes a new note on the phone, or goes to the agent. A screenshot is shared from Android's own screenshot preview like any picture; the app does not watch for them.
- `@/core/*` is `../packages/core/src/*` (`@tefnotes/core`), the pure logic, no React Native imports, shared with the web
  app, the CLI and the extension and unit-tested there (`cd ../packages/core && bun test`). Never add app-only code to it, and
  never copy it back into `mobile/`. What the phone leans on: `notes` (frontmatter, ids, 3-way
  merge), `todo` (tasks as records: types, patch, tick and rollover, views, field-level merge), `things` (what
  the task screens do with the records: When, deadline and repeat choices, the reminder plan), `today`
  (Today's list over `views`; the widget uses it too), `dates`, `photos`, `pocketbase` (the server client, also the CLI's),
  `share`, `clip`, `agent` (model pick, Ask wording, write diffs and flags, confirm reasons, the cards), `note-sort` and `planner` (Home's note orders, and the days and counts of the phone's strip and the web's month), `lens` (the global
  filter: `inLens`/`withinLens`, `inheritTags`, the assistant's `filter`), `theme`,
  `page-theme`, `editor-bridge` and `pdf-bridge` (WebView message types), `http`, `links` (a pasted URL's title),
  `record-links` (links between records: shapes and questions), `time`, `types`.
  Metro finds it through `watchFolders` in `metro.config.js`; resolution of `@/core/*` is tsconfig `paths` (and the alias in
  `vitest.config.mts`).
- `src/store/`: zustand stores and the SQLite layer. `db.ts` (schema, FTS5, append-only migrations; tasks in
  `records`, links in `links`), `notes.ts` (index and sync engine), `todo.ts` (`useTodo`: tasks and links in memory,
  their edits and sync),
  `sync.ts` (what both syncs share), `live.ts` (the server's realtime feed: notes, photos, chats, tasks, links;
  one connection, wired in the root layout), `attachments.ts`, `previews.ts` (link previews cached in MMKV), `ticks.ts` (a tick on
  a task waits 1.5 s so it can be taken back, then `useTodo.complete`), `reminders.ts` (open tasks with a `remind` time as
  local notifications, channel `tasks`, rescheduled on every task save and sync), `agent.ts` (the agent's transport and model
  list), `chats.ts`, `assistant.ts` (the page context from a route, where a UI tool goes), `keys.ts`, `share.ts` (the pending share and saving it), `clip.ts` (a share through the server's clip
  routes: the picture's two JPEGs, suggest, save, then the sync that brings down what it touched), `note-out.ts` (a note handed
  to the assistant as a draft, or shared as a `.md` file), `prefs.ts`, `lenses.ts` (below).
- **Lenses** (`@/core/lens`): a lens is a name and tags, a `lenses` record on the server (no rev, last write wins). `store/lenses.ts`
  caches the definitions in their own MMKV file (read on launch and foreground, like tag definitions); which one is on is the
  `lensRec` pref of this phone, none the default, a stale id reads as none (`useActiveLens`, `activeLensNow`). It is switched, made,
  edited and deleted only on Home (`ui/lens.tsx` `LensSwitcher`: the app's mark in the header, with the lens's name beside it while one is on), and shown nowhere else: the tab bar carries no
  lens chip (removed 2026-11-06 at the owner's ask). The filter sits where lists are *read*, never at a
  route: `useNoteList` (Home and its search, the note picker), `useTodoViews`/`useTasks` (Tasks, Home's lists and count) and the widget's `draw.tsx`; `inLens` is any of the lens's tags. A note or task opened by id, a reminder, a link's far end
  and the tag picker's names are not filtered. `useNotes.create` and `useTodo.add` add the lens's first tag (`inheritTags`); nothing
  the sync or the server makes does.
- `src/agent/ui-tools.ts`: the assistant's page context per request and its UI tools done with expo-router.
- `src/agent/background.ts`: the foreground service that keeps a streaming reply alive, the "answer ready" notifications, and
  the one handler for every notification tap (a reply's chat, a task reminder's task).
- `src/ui/`: shared components. `note.tsx` (a note, always in `editor.tsx`, as on the web: no read mode), `editor.tsx` (the body editor: the web app's
  ProseMirror page in a WebView, generated into `editor-html.ts`), `pdf.tsx` (pdf.js in a WebView, generated into
  `pdf-html.ts`), `attach.tsx` (gallery, camera, PDF), `tasks.tsx` (a task row: tick, swipe for When or Delete),
  `task-sheets.tsx`, `tag-dialog.tsx` (the tag picker, over a `TagTarget` from `tag-targets.ts`: notes and tasks each supply their lists and writer; `tags-chip.tsx` is the chip that opens it), `links.tsx` (a note's linked tasks, under its title), `draft.ts` (a text field saved as typed), `use-theme.ts` (`useTheme()`, the active
  theme; `chooseTheme`), `models.tsx`, `dictation.ts`, `conflicts.tsx`.
- `src/ui/ds/`: the design system, imported as `@/ui/ds`: Reusables-style components on `@rn-primitives` (dialog, menu,
  switch, checkbox), our own Sheet (React Native `Modal` + `Animated`: Reanimated 4.5 cannot animate inside a Modal on RN
  0.86, which also killed `@gorhom/bottom-sheet`) and Uniwind classes. Screens build from these; no other UI kit.
  `src/ui/chat/` holds the chat's pieces (bubbles, composer, tool calls, cards, a turn).
- `src/widget/`, `plugins/`, `index.ts`: below.
- `test/`: vitest over the store and sync layers (the database, the sync engine, attachments, task order), with native modules
  mocked (`test/helpers.ts`). Not `@/core`'s tests.

## Themes

`THEMES` in `@/core/theme` (`../packages/core/src/theme.ts`); `THEME_NAMES` lists them. Picked in Settings >
Appearance and kept in prefs. Each is a Uniwind theme of the same name in the generated `src/theme.css`, so classes
(`bg-card`, `text-dim`) follow `Uniwind.setTheme`. JS that needs a colour (icons, navigator options, enriched-markdown styles,
a note card's tint) reads `useTheme()`. Never import `C`, `TINT` or `NOTE_COLORS` into a component: they are the default
theme, for `app.config.ts` and the builds that show one look only (the site, the extension). The editor and PDF WebViews get the theme over their bridges
(`@/core/page-theme`), on load and on every switch.

- A theme name beyond Uniwind's own `light`/`dark` is registered twice: `extraThemes` in `metro.config.js` and `--theme` in
  `package.json`'s `typecheck`. Missing one, `Uniwind.setTheme` throws for it (or the types refuse it). Adding a theme to
  `THEME_NAMES` means touching both.
- Uniwind refuses a build where one theme lacks a variable another sets: every theme sets the same names
  (`scripts/theme-css.ts` writes them all from the same keys).

## Storage and sync contract

The server is the source of truth. The phone holds a cache plus unsent edits. Everything local is rebuildable from the
server; a schema change to the cache may simply start it over (`db.ts` migration 2 does). The `rev` rule behind all of it,
and the note and task formats, are in `../ARCHITECTURE.md`; a write without the `rev` it was based on is refused by the
server, and so must it be here.

- **SQLite** (`expo-sqlite`, file `tefnotes.db`) holds note bodies and sync state, one row per record. Columns: `NoteRow` in
  `src/store/db.ts`. `rec`/`rev` are the server record and version the text was last in step with; `deleted` is a tombstone
  until the delete is pushed. FTS5 over a folded copy is kept by triggers.
- **zustand `useNotes`** holds only the list index in memory and the `sync` state. Bodies are read from SQLite when a note
  opens (`useNoteText(path)`). Writes go `write(path, text)` → SQLite → index refresh.
- **Notes sync** (`syncNotes()`): pull, then push. Pull is one listing of every record's `path, rev, kind`, then a
  fetch of only those whose rev differs from the local row (`kind` rides the listing into the row's column, since a row
  cached before the column existed has the rev of it and lacks it); a record gone from the server and not dirty locally is removed. Push is an update
  per dirty row carrying the rev it was based on, a create for a new one, a delete with its rev for a tombstone. A stale rev
  (409) gives a 3-way line merge against `base`; overlap is a `conflict` and the user picks a side. A new note whose path the
  laptop took first moves aside to `-2`. It runs on launch, foreground, background, when leaving a note, 1.5 s after the last
  write (so an open note leaves "unsent" on its own) and on any realtime event while in front.
- **Tasks** (`syncTodo()`, `src/store/todo.ts`): one `records` row each (`RecordRow`: `data`, `base` as of
  `rev`), all held in `useTodo`. The same pull and push, records instead of files. A 409 is merged field by field against `base` (`mergeRecord` in `@/core/todo`), the phone's edit winning a field
  both changed, so there is no conflict to pick. Same triggers as notes; their own `sync` state.
- **Links** (`../ARCHITECTURE.md` "Links"; in `syncTodo()` too): one `links` row each (`LinkRow`: the link, `pushed`, a
  tombstone flag), no rev. Pulled after the tasks as a set of ids (`pb.links.ids`, then a fetch of the ids the phone lacks); a
  row once in step that the server no longer has is gone (a delete or a cascade). Pushed after the tasks: an add per unsent link
  (idempotent: the server's copy comes back, perhaps under its own id, which the row takes), a remove per tombstone. A link
  whose task is deleted here is never shown and, unsent, dropped; one whose task hasn't gone up yet waits a round; a 404 (an
  end gone from the server) drops it. Ticking a repeating task makes its links again on the next round (`linksForNextRound`).
- **No sign-in**: Settings holds only the server's address. The server's rules are open and the private network is the gate.
- **MMKV** for prefs (including the agent's model pick) and which chat is open. **SecureStore** for the server address only:
  the phone holds no model key.
- A note: `parseNote(path, text)` and `serializeNote(meta, body)` in `@/core/notes`. Title is the frontmatter `title`, else the
  first `# ` heading, else the slug. `newNotePath(title, now)` gives `notes/YYYYMMDD-<slug>.md`, the slug ASCII-folded (Greek
  transliterated), at most 40 chars, uniquified with `-2`, `-3`.

## Agent client

The agent runs on the server (a sidecar under `/agent`, same origin as the notes server). The phone is a window on it.

- `POST /agent/chat` `{ id, messages, model, writesWithoutAsking, effort, context }` streams an AI SDK UI message stream: `useChat` over
  `DefaultChatTransport` with expo/fetch (`src/store/agent.ts`). Every request carries the model pick, the effort (`@/core/agent`
  `EFFORT`: step limit and reasoning) and "write notes without asking", all this phone's prefs; the server still asks after the chat read the web.
- `GET /agent/models` → `{ provider, available, default, models, web }` feeds the picker (`src/ui/models.tsx`). `pickModel`
  (`@/core/agent`) falls back to `default`, also for a pick the server no longer offers.
- Chats are `chats` records on the server. The phone names a new chat (a PocketBase-style id) and makes its record empty just
  before the first send (`ensureChat`); the server writes messages and title back. The list follows the realtime feed; the open
  chat takes the server's copy while idle when its message ids differ (the laptop went on with it). A chat whose history
  failed to load can't be sent to: the server would save it without that history.
- Note-write confirm cards are AI SDK tool approvals, answered with `addToolApprovalResponse` and resent by
  `lastAssistantMessageIsCompleteWithApprovalResponses`. The card's preview reads the phone's copy of the note. Only the
  newest message's card is live; the server settles older unanswered ones with `UNCONFIRMED` (`@/core/agent`), which both
  clients match.
- Notes and tasks in a chat are cards (`src/ui/chat/cards.tsx`), from two typed parts of the stream read with
  `cardsByPart`: a write tool's result `card`, and the `show_items` tool's `cards`. Shapes and builders (`noteCardOf`,
  `taskCardOf`) live once in `@/core/agent`; the client draws the card of its own copy of the record, built
  with the same builder, and falls back to the snapshot. The task box ticks through `toggleTask`, so it keeps the 1.5 s
  take-back.
- The `show_*` tools return a typed widget (`@/core/widgets`, read with `widgetOf`), drawn by `src/ui/chat/widgets.tsx`: day, week,
  review, quote, link, lens preview; display only, the one write is the lens preview's Save, over `saveLens`. `ask_choice` is the
  one UI tool the app does not answer itself: `onToolCall` skips it (`isAppTool`), `src/ui/chat/choice.tsx` draws its buttons
  and the owner's tap answers it (`addToolOutput` with `choiceOutput`) from the newest turn only.
- A message handed to the agent from elsewhere (a note's "Ask about this note", a share, the Quick widget) goes through
  `useChats.startWith(text, join)`: a fresh chat (or, while a reply streams, the chat on screen once it ends) on the Ask tab,
  which sends it once in front and idle. A share arrives as a user message opening with `<shared>` (`askText` in `@/core/share`).
  Photos and PDFs are attached to a note first, and that note is pushed before the message goes, since the agent reads it on
  the server.
- A share of a link, text or one photo is filed as the browser extension files a page (`@/core/clip`, `src/store/clip.ts`):
  `POST /api/tefnotes/clip/suggest` with the photo downscaled (`lookSize`), then `POST /api/tefnotes/clip` into a suggested note
  or open task, or as a new note. The server holds the key and writes; the phone syncs afterwards. A photo into a note is the
  server's attachment, into a task only a link line. With no server set, when suggest fails, or when a save to a new note can't
  reach the server, the share is a new note on the phone (`saveShared`), as it always is for PDFs and several photos; a refusal
  from the server is shown and nothing is written.
- Replies keep streaming in the background (`src/agent/background.ts`).

## The assistant (the Ask tab)

The contract is `@/core/assistant` (`../packages/core/src/assistant.ts`); the server's half is `server/agent/src/assistant.ts`.

- One chat, on its own tab (`src/app/(tabs)/ask.tsx`). Returning to Ask starts a fresh chat, except an explicit history/notification selection, a handoff, or a reply still streaming; past chats remain in History. The compact header keeps model, history and new-chat controls on one row. An overlay sheet over every screen with a launcher was tried
  (2026-11-02) and dropped at the owner's request: keep it a screen.
- The keyboard is dismissed when the reply starts streaming, so the answer can be read.
- Every request carries `context: AssistantContext` (`client: "phone"`), built at send time by `screenContext()` from the last
  screen before Ask or its past chats (`useRouteSeen` in the root layout) and the phone's copy of notes, tasks and projects
  (`contextFor`). The Tasks page shown is `useAssistant`'s `list`.
  While a lens is on, `contextFor` sets `filter` with `contextFilter(lens)` (`@/core/lens`) on every screen; the server's prompt scopes to it.
- UI tools (`open_note`, `open_task`, `open_project`, `go_view`) have no server `execute`: `onToolCall` does them with
  expo-router (`runUiTool`) and always answers with `addToolOutput` (`uiError` for a view the phone lacks, pinned and memory,
  or a record it doesn't hold). `sendAutomaticallyWhen` is `resumes`: an answered approval, or a last step holding a UI tool
  call all answered. Not every finished tool call: that would loop.
- Hand-overs (`startWith`, `startDraft`) navigate to Ask, and only the focused tab takes them. `tefnotes://ask` and a finished
  reply's tap open Ask; the tab shows a dot for an answer that finished while it wasn't in front.

## Live Updates (Android 16)

- Only the reply in flight is one (`plugins/live-update.js`, called from `src/agent/background.ts`): ongoing, user-started,
  time-sensitive. Task reminders and a day's "3/7 done" are deliberately not: Google's guidelines rule out alerts, upcoming
  events and quick access to app features, and the OS throttles apps that post them. Don't promote them.
- The service's notification (id 92901, channel `RN_BACKGROUND_ACTIONS_CHANNEL`) is the library's and has no promotion API,
  so the module re-posts that same id promoted. Never change the id or channel there without changing the library's, and never
  post it after the service stopped.
- It is a no-op below Android 16 and when `canPostPromotedNotifications()` is false (the per-app "Live updates" switch); the
  library's ordinary notification then stays. The finished reply's notification is an ordinary one by design: a Live Update
  ends with its activity.
- Needs `androidx.core` 1.17+ (`setRequestPromotedOngoing`, `setShortCriticalText`, `ProgressStyle`; 1.18 resolves today); the
  `android-36` SDK stubs lack the framework `Notification.Builder` method, so call it through `NotificationCompat`. The chip
  text stays under 7 characters (shown whole).
- Promotion needs no `setColorized`, no custom views, a title, an ongoing flag and a channel above `IMPORTANCE_MIN`.

## Home and lock screen widgets

- `react-native-android-widget` (expo-widgets is iOS-only in SDK 57): `TodayWidget` and `QuickWidget`, declared once in
  `src/widget/config.ts` (read by `app.config.ts`), both `home_screen|keyguard`. They are drawn in JS from the SQLite tasks
  store and the saved theme (`src/widget/draw.tsx`); Today's list is `@/core/today` over `views`, never a second "today".
- The task handler is registered in `index.ts` (`package.json` `main`), not in a route: Android starts the JS headless for a
  widget, with no screen mounted. The app redraws on every `useTodo`/theme change and when it goes to the background. The
  widget redraws every 30 min (Android's minimum), which is also when the day turns over on it, and then syncs.
- Widget components are plain functions under `"use no memo"`: the React Compiler would turn them into hook calls, which the
  library rejects. Colours go through `paint()` (hex or `rgba()` only); icons are Lucide's `__iconData` as SVG text.
- A widget tick is written at once (no take-back second): the task stays listed, faded, and its box reopens it. Ticks work on
  the lock screen without unlocking; a tap that opens the app asks to unlock (MainActivity isn't `showWhenLocked`).
- Quick actions land on `src/app/widget/[action].tsx` (`tefnotes://widget/ask|note`), which passes straight through.

## Generated files

`src/ui/editor-html.ts`, `src/ui/pdf-html.ts` (built from `../web` by `pnpm pages`), `src/theme.css` and
`src/uniwind-types.d.ts` are gitignored and never hand-edited; `eslint.config.js` ignores the two pages. If a type error
mentions a missing one, run `pnpm pages` (or `pnpm typecheck`), do not stub it. A message type that crosses a WebView bridge
is changed in `@/core/editor-bridge` or `@/core/pdf-bridge` and in the `web/` page in the same change.
