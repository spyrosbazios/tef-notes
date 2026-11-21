# TEF Notes chat agent

A small bun server that runs the chat agent: it streams an AI SDK UI message stream (`useChat` with
`DefaultChatTransport`) and edits notes and tasks through PocketBase's API, every write a `rev`
compare-and-swap. It is a sidecar because PocketBase's JS hooks cannot stream a response. Its design (tools, memory,
the web-taint guard, confirm cards) is in [../../ARCHITECTURE.md](../../ARCHITECTURE.md).

There is no sign-in: it listens on loopback and a reverse proxy on a private network maps `/agent` on the app's origin
to it. See the security model in [../README.md](../README.md).

## Routes

| Method | Path | |
|---|---|---|
| `POST` | `/agent/chat` | Streams a chat turn. Body: `id`, `messages`, `model`, `writesWithoutAsking`, and optional `context` (below) |
| `GET` | `/agent/search` | Notes by words and meaning, `q` and `limit` (1 to 30): the chat's `search_notes`, no model call (`src/search.ts`; contract `packages/core/src/find.ts` `SearchHit`); the CLI's `search` |
| `GET` | `/agent/models` | The models; `provider` names the server's; `available` is true when its key is read |
| `GET` | `/agent/ocr` | Scanned PDFs: `on`, the `languages` they are read in, pages `read` and `waiting`, `failedPages`, `failedPdfs`, the last `problem`; or `on: false` and `why` (`src/ocr.ts`, [../README.md](../README.md) "Scanned PDFs") |
| `GET` | `/agent/push/key` | The VAPID public key for `pushManager.subscribe`; 404 while push is off (`src/push.ts`, [../README.md](../README.md) "Push reminders") |
| `POST`, `DELETE` | `/agent/push/subscribe` | Store or forget a browser's push subscription (`packages/core/src/push.ts` is the contract) |
| `GET` | `/agent/places/suggest`, `/agent/places/place`, `/agent/places/map` | A task's place search: suggestions as you type, the place picked, its map picture in the app's theme, over OpenStreetMap with no key (`src/places.ts`, contract `packages/core/src/places.ts`) |

## Always-on assistant

A client that stays with the owner through the app (the web's docked panel) sends `context` with every
message: what is on screen, as `AssistantContext` (`packages/core/src/assistant.ts` is the contract; `contextOf` reads it, and
a context that can't be read is ignored: the chat is a plain one). The server renders it as a `<screen>` block, last in the
`<context>` of the newest user message (`src/assistant.ts`, `src/agent.ts`), so the instructions stay one fixed prefix for the
prompt cache. It is the owner's text, quoted and bounded, never instructions, and not web taint.

With a context the agent also has the UI tools `open_note`, `open_task`, `go_view` and `ask_choice`: declared without an
`execute`, so the call streams to the client and the turn waits. The client does it in the app (`onToolCall`), answers
with `addToolOutput({ tool, toolCallId, output })`, `{ ok: true }` or `{ error }` (`UiOutput`), and resends
(`sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls`). They write no data, so there is no confirm card. A
call left unanswered (the owner typed on) is closed as an error on the next send (`settle` in `src/guard.ts`). `ask_choice` is
the one the owner answers, not the app: the client draws its buttons and answers with `{ chosen: [ids] }` (`ChoiceOutput`); the
choice writes nothing, any change after it is the model's own write tool with its confirm card.

## Application services

`src/application/notes.ts` and `todo.ts` own request-scoped reads, writes, caching, revision retries, merges, links,
and recurring-task completion. They return saved records/text rather than assistant cards. `src/notes.ts` and
`todo.ts` adapt those results for the assistant; companion routes, direct search and index warming use the services.
Search by asking uses the same read-tool factories as chat with application services, without constructing write adapters.
`src/application/metadata.ts` holds timestamp helpers shared with reminders and planning. The root import-boundary check
keeps these services independent of assistant modules and card builders.

## Tool policies

Each tool-definition module also declares a typed policy table: approval mode and validator, whether its result
contains external text or record references, whether taint withdraws it, and whether it requires Exa. Adding a tool
requires a policy entry (`Policies<T>` in `src/tool-policy.ts`). `src/tools.ts` assembles the tables; `src/agent.ts`
derives approval callbacks and availability from them. The pure guard and loop utilities receive policy lookup as an
argument, so they do not import the tool registry. Tests cover completeness and the existing approval/taint behavior.

## Chat history

`packages/core/src/chat-history.ts` owns the versioned persistence envelope shared by the web and agent. The additive
`chats.historyVersion` field is introduced by migration `1794900000_chat_history.js`; legacy arrays remain readable,
and writes use version 1. Unsupported future versions and malformed records fail explicitly before a chat runs.
Tool inputs and outputs are opaque historical data. `guard.ts` repairs only the execution copy for today's tool schemas;
the stream and `chats.ts` saver keep the original parts, including during continuation and periodic saves. Taint is
classified before repair so an obsolete read cannot remove the approval requirement.

## Widgets

The agent never lays anything out. `show_day`, `show_week`, `show_review`, `show_quote`, `show_link` and `show_lens`
(`src/widgetTools.ts`, rules in `src/plan.ts`) read the owner's records and return `{ widget }`, typed and read back by
`packages/core/src/widgets.ts` (`widgetOf`); each client draws a fixed component per widget `type`. They are read-only
(no confirm card) and the model is told only what was shown, with ids and paths. `find_free_slots` is plain data for the model.
A task has no length: a booking (`when` + `remind`) holds its whole hour, the unit the double-booking check counts in.
`show_link` goes through the server's link-preview route (the SSRF guard lives there) and is refused once the chat has read
the web or a PDF.

## Other agent harnesses

Claude Code, Codex and other coding agents reach the notes through the CLI, driven by the
[`tefnotes` skill](../../skills/tefnotes/SKILL.md): every write the same `rev` compare-and-swap, and marked `tainted`
(`TEF_NOTES_AGENT=1`). Their search by meaning is `GET /agent/search` (above).

## Environment

| Variable | Default | |
|---|---|---|
| `TEF_NOTES_PB` | `http://127.0.0.1:8097` | PocketBase's URL (compose sets `http://pocketbase:8090`) |
| `HOST` | `127.0.0.1` | Listen address (the image sets `0.0.0.0`; compose publishes it on loopback only) |
| `PORT` | `8098` | Listen port |
| `TEF_NOTES_KEYS_DIR` | `/run` | Keys are read from `<dir>/<name>/api-key` (`llm`, `exa`, `push`) on every use |
| `TEF_NOTES_VAPID_SUBJECT` | | `mailto:` or https URL for push reminders; with the key at `<dir>/push/api-key` they switch `src/reminders.ts` on |
| `TEF_NOTES_PROVIDER` | `deepseek` | The model provider (`src/models.ts` `PROVIDERS`) |
| `TEF_NOTES_MODEL` | the provider's | The default model |
| `TZ` | system zone | The day used in the prompt and for a new note's name |
| `TEF_NOTES_OCR` | `eng` | The languages scanned PDFs are read in, Tesseract's codes joined by `+`; empty: off. Needs `tesseract` on the `PATH` (the image has it; from source, install it), else off |
| `TEF_NOTES_DATA` | `./data` | Derived data: the search vectors and their model, PDF tile pictures, what OCR read and its language data; and `approval-secret`, which signs the confirm cards (losing it only voids the cards waiting at that moment) |

Without the provider's key (`llm`) a chat is refused; without `exa` the web tools are left out.

## Development

The shared code in `packages/core` is imported as `@/core/*`; `tsconfig.json`'s `paths` map it and bun honours them at
runtime, so there is no build step.

```sh
bun install
bun test
bun run typecheck
TEF_NOTES_PB=http://localhost:8097 TEF_NOTES_KEYS_DIR=/path/to/keys bun run start   # against a running PocketBase
```
