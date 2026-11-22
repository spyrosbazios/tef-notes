# TEF Notes server

<!-- reviewed: 2026-11-21 -->

The server half of TEF Notes, a self-hosted personal notes and tasks system: [PocketBase](https://pocketbase.io) with
JavaScript hooks (`pb_hooks/`) and migrations (`pb_migrations/`), plus a small bun sidecar that runs the chat agent
(`agent/`, see [agent/README.md](agent/README.md)). Voice input and Talk go out to [Fish Audio](https://fish.audio) from
there, so the host runs nothing extra for them.
`docker compose up -d` pulls them as multi-arch (amd64, arm64)
images from GHCR, the web app already in PocketBase's `pb_public`. The signed Chrome extension is not in them: it needs
your origin and your key, so you build it yourself ("The browser extension's CRX").

The note format, the write contract and the agent's design are in [../ARCHITECTURE.md](../ARCHITECTURE.md). The
extension's side is in [../extension/README.md](../extension/README.md).

## Security model (read first)

**There is no sign-in.** Every collection's rules are open (`pb_migrations/1792400000_open.js`), so anything that can
reach the PocketBase or agent port can read, write and delete every note, task and file. The private network in front
of it is the only gate.

- Both services bind to loopback on the host (`127.0.0.1`). Keep it that way.
- Put a reverse proxy on a private network in front, on one origin: for example Tailscale serve mapping `/` to the
  PocketBase port and `/agent` to the agent port. The web app and the extension call `/agent/*` on the same origin as
  the API.
- Never expose it publicly: no port forward, no public tunnel, no `tailscale funnel`.
- The PocketBase admin UI (`/_/`) has its own superuser login, but it is reachable through the same port.

## Requirements

- Docker with Compose. Only `server/` is needed to run the published images.
- A [Fish Audio](https://fish.audio) key for voice input and Talk (`TEF_NOTES_KEY_FISH`); without one both are off.
- Scanned PDFs are read by Tesseract inside the agent: its language data (a few MB a language) is downloaded from
  raw.githubusercontent.com on first use into the `agent_data` volume (see Scanned PDFs).
- To build from source, or the extension: BuildKit (the signing key is a build secret) and the whole repository cloned,
  because the build context is the repo root (the web app, extension and agent share `packages/core` and `assets/`).
- bun, only to run the tests (see Development).

## Quick start

```sh
cd server
cp .env.example .env              # then edit it: at least TZ, and TEF_NOTES_OCR if your scanned PDFs aren't in English
mkdir -p keys/typesafe keys/deepseek keys/exa keys/push   # keys/<TEF_NOTES_PROVIDER> for another model provider
# put each provider's key, alone, in keys/<provider>/api-key (see AI providers); all optional
docker compose up -d              # pulls ghcr.io/spyrosbazios/tef-notes and tef-notes-agent
docker compose exec pocketbase ./pocketbase superuser create you@example.com 'a-long-password'
```

The superuser is for the admin UI at `/_/`; the apps themselves need no account. Check it:

```sh
curl -s http://localhost:8097/api/health          # PocketBase is up
curl -s http://localhost:8097/ | grep '<title>'   # the web app, same origin
curl -s http://localhost:8098/agent/models        # the agent; "available": true when the provider's key is read
curl -s http://localhost:8098/agent/ocr           # scanned PDFs: "on": true and the languages they are read in
```

Use your proxy's origin instead of `localhost` to test the path the clients take.

## Configuration

Everything is an environment variable with a default; `.env.example` lists them. `docker compose config` renders the
result.

| Variable | Default | Effect |
|---|---|---|
| `TEF_NOTES_VERSION` | the latest | The release to pull (the images' tag, e.g. `0.1.0`). In the extension build it is also the extension's version. |
| `TEF_NOTES_URL` | `http://localhost:8097` | The public origin clients reach. Read by the extension build only: its `update_url` is built from it, and Chrome installs and updates an extension only from https, so use your proxy's address. |
| `PB_PORT` | `8097` | Host port for PocketBase, loopback only. |
| `AGENT_PORT` | `8098` | Host port for the agent, loopback only. |
| `TZ` | `UTC` | The server's time zone (an IANA name). A note the server writes is dated and named by this zone's day; the agent uses it for the prompt's date and for push reminders' wall-clock times, so it must be yours. |
| `TEF_NOTES_KEY_TYPESAFE` | `./keys/typesafe` | Directory holding `api-key`, mounted read-only at `/run/typesafe`. |
| `TEF_NOTES_KEY_LLM` | `./keys/<TEF_NOTES_PROVIDER>` | Same, for the model provider, mounted into both containers at `/run/llm`. |
| `TEF_NOTES_KEY_EXA` | `./keys/exa` | Same, for Exa, mounted into the agent at `/run/exa`. |
| `TEF_NOTES_KEY_PUSH` | `./keys/push` | Same, for the VAPID private key of push reminders, mounted into the agent at `/run/push`. |
| `TEF_NOTES_VAPID_SUBJECT` | | A `mailto:` or https URL the push services may reach you at. Empty: push reminders are off. |
| `TEF_NOTES_CRX_KEY` | `./no-crx-key` | Path to the extension's signing key, inside `server/`. Extension build only, see the extension section. |
| `TEF_NOTES_PROVIDER` | `deepseek` | The model provider for the chat agent and the server's clip and tag-description writing: `deepseek`, `anthropic`, `openai`, `xai`, `qwen`, `zai`, `ollama`. Defaults and keys: [AI providers](../docs/ai-providers.md). |
| `TEF_NOTES_MODEL` | the provider's | The model; Ollama has no default. |
| `TEF_NOTES_LLM_URL` | the provider's | Its API root, e.g. another Qwen region. |
| `TEF_NOTES_OLLAMA_URL` | | Ollama only: where it serves (`http://host.docker.internal:11434` for one on the Docker host). |
| `TEF_NOTES_KEY_FISH` | `./keys/fish` | The Fish Audio key (`api-key`), for voice input and Talk. Without it the apps hide their mic and Talk's tab, and `/agent/transcribe` and `/agent/talk` answer 404. |
| `TEF_NOTES_TALK_VOICE` | | Talk's voice: a Fish voice model id. Settings picks one from Fish's list (and its speed), and that wins; with neither, the server pins the first voice Fish lists. |
| `TEF_NOTES_OCR` | `eng` | The languages scanned PDFs are read in: Tesseract's codes joined by `+`, the main one first (`ell+eng`, `deu+eng`). Set it empty (`TEF_NOTES_OCR=`) to turn it off. See Scanned PDFs. |

Deployment-specific additions (labels for a dashboard, extra networks, resource limits) go in
`docker-compose.override.yml`, which Compose merges over the base file on its own and git ignores. Copy
`docker-compose.override.example.yml` as a starting point and delete what you do not use.

## AI providers

Each provider is one file, `api-key`, holding the key alone. It is mounted read-only and re-read on every use, so a new
or changed key needs no restart. The agent runs as uid 1000 in its container, so the key files must be readable by that
user (`chmod 644`, or owned by uid 1000). Create the directories before the first `up`, or Docker creates them
root-owned. Every provider is optional.

| Provider | Powers | Without it |
|---|---|---|
| `typesafe` | The auto-tagger (a per-minute job tagging notes) and the clip's destination suggestions | Nothing is auto-tagged; clip suggest returns `pick: "new"` and saves still work |
| the model provider (`llm`) | The chat agent, the clip's tidied note and optional summary, tag descriptions | The chat is refused and models are listed with `available: false`; a clip's note is saved as typed and a requested summary reports `"failed"` |
| `exa` | The agent's web search and page-reading tools | The agent runs without its web tools |

Place search needs no key: it uses OpenStreetMap's free public services (Photon, Nominatim, the standard tiles), so the
agent needs outbound access to `photon.komoot.io`, `nominatim.openstreetmap.org` and `tile.openstreetmap.org`.

A failure is logged with its status, never the key. Auto-tagger and clip failures show as `autotag:` and `clip:` lines
in PocketBase's logs (admin UI, Logs).

## Push reminders

The installed web app gets a task's reminder (its `when` day and `remind` time) as a Web Push notification, sent by the
agent every minute. Set up once: generate a VAPID key pair with
`bunx web-push generate-vapid-keys --json`, put its `privateKey` alone in `keys/push/api-key` (the public key is derived
from it; keep it unreadable to others, `chmod 600`, owned by uid 1000), and set `TEF_NOTES_VAPID_SUBJECT` to
`mailto:you@example.com` in `.env`. Then `docker compose up -d`; `docker compose logs agent` says "web push is off" once
when either is missing. A reminder rings within an hour of its time and not after, and never for a time set after it. A
browser the push service no longer knows (404, 410) or that fails five sends in a row is forgotten; a reminder every
delivery of which failed is tried again on the next minute's scan, until an hour past its time. A reminder's time has no
zone: the agent reads it in its own `TZ`, so `TZ` in `.env` must be your own zone (default `UTC`, which rings hours off
anywhere else); the agent logs a warning at start when push is on and `TZ` is unset. At most 20 devices are kept (a
further one is refused with 409), and before every send the push service's name is resolved and must point only at public
addresses, or the subscription is deleted.

## Voice input

The mic in the apps (the assistant, a new task, a task's notes, a note's header, search, Settings → Voice) records mono
16 kHz samples in the browser and, while you talk, cuts them at pauses into pieces of 6–20 s, each posted to the agent's
`POST /agent/transcribe` as it is cut. The agent wraps the piece in a WAV and sends it to [Fish Audio](https://fish.audio)
(`POST /v1/asr`, `transcribe-1-pro`) and returns its text; stopping waits only for the last piece. The agent keeps
nothing: not the recording, not the text, only what lands in the field it was dictated into. The recording itself does
leave the server, for Fish, for as long as the request takes.

- **The key is the switch**: `TEF_NOTES_KEY_FISH` (a directory holding `api-key`), mounted read-only and re-read on every
  use. Without it `/agent/transcribe` and `/agent/talk` answer 404 and the apps hide their mic and Talk.
- **Setting one up**: create a key at fish.audio (Get an API key). New accounts start with no credit, which only matters
  for the paid voice model: `s2.1-pro-free` is the same engine and costs nothing, under Fish's fair-use limits.
- **Speech to text is billed per audio hour** (about $0.36), so a minute of dictation is well under a cent.
- **The microphone needs a secure context**: browsers allow `getUserMedia` only on `https://` or `localhost`, so over a
  plain `http://` LAN address the mic is hidden. The reverse proxy's HTTPS origin (Tailscale Serve, Caddy) gives it.
- **Turning it off**: leave the key out (or `docker compose up -d` with `TEF_NOTES_KEY_FISH` pointing at nothing).
- Check it: `curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/octet-stream' --data-binary ''
  http://localhost:8098/agent/transcribe` answers `400` (an empty clip is not samples) with voice input on, `404` without
  the key, `502` when Fish cannot be reached.

Contract: `packages/core/src/voice.ts`; the agent's half: `agent/src/transcribe.ts`; the client: `agent/src/fish.ts`.

## Talk

A spoken conversation with the same assistant, over one WebSocket at `/agent/talk` (the web app's Talk tab; the contract
is `packages/core/src/talk.ts`). The agent holds both halves of the speech at Fish Audio and the thinking runs on your
model provider:

- **The ear** (`wss://api.fish.audio/v1/asr/realtime`, `transcribe-stream-1`) decides what a turn is: the owner taking
  their turn, an acknowledgement over the voice (a "mm-hm" the assistant keeps talking through), or a noise in the room.
  It hears the assistant's own lines too, so a follow-up is understood in context. Billed per session second.
- **The voice** (`wss://api.fish.audio/v1/tts/live`, S2.1 Pro) speaks the reply as it is written, a sentence at a time.
  Billed per character; the free model costs nothing (Settings → Voice picks it).
- **The turn** is the chat's own agent over the chat's own tools: a write still asks with a card (Settings → Agent, read
  every turn), the web-taint rules still apply (a chat that read the web stays tainted in Talk), and the UI tools (open a
  note, go to a view) are done by the app. Speaking over the reply stops it. The conversation is saved as a chat, so it
  reopens in the text assistant.
- **The caps**: the ear is billed for as long as it is open, so the agent ends a conversation after 5 minutes with nothing
  from you and after an hour in all (`TALK_LIMITS` in the contract); starting again is one tap.

Nothing is re-billed per turn, which is what makes this affordable: a ten-minute conversation is a few cents of voice and
the model tokens any chat would cost. Off without the Fish key; turning it off is the same as voice input.

Measured on this host (2026-11-15, `latency: "balanced"`, first audio for a short clause): **217 ms** through `s2.1-pro`
and **608 ms** through `s2.1-pro-free` — the free model has no time-to-first-audio guarantee and it shows; what it costs
is that, not the price. The paid model is about $0.015 a minute of speech. The ear answered a realtime turn with its
final transcript and `user_turn: true` as soon as the audio ended.

## Scanned PDFs

A PDF page with no text of its own (a scan, a photo of a page) is read by [Tesseract](https://github.com/tesseract-ocr/tesseract)
in the agent, so the assistant can read it (`read_attachment`, the open note's first pages) and search by meaning finds
its note. Nothing leaves the server, and there is nothing to set up beyond the languages:

```sh
# server/.env: the languages your scanned documents are in, the main one first
TEF_NOTES_OCR=ell+eng             # Greek and English; deu+eng, fra, spa+eng, chi_sim ... (default: eng)
docker compose up -d
```

The codes are Tesseract's, three letters each: [every language it has](https://tesseract-ocr.github.io/tessdoc/Data-Files-in-different-versions.html).
Name each language your documents use: a page is read with all of them at once, and a language left out comes back as
wrong letters.

- **Check it**: `docker compose logs agent | grep scanned` says `agent: scanned PDFs are read by Tesseract (ell+eng)`,
  or why not (a code Tesseract doesn't have, a download that failed). `curl -s http://localhost:8098/agent/ocr` answers
  `{"on":true,"languages":["ell","eng"],"ignored":[],"read":57,"waiting":0,"failedPages":0,"failedPdfs":0,"problem":""}`: pages
  read, pages still to read, pages and PDFs that couldn't be (a PDF that wants a password can't), and the last failure.
  A code Tesseract has no data for (`TEF_NOTES_OCR=gre+eng`: Greek is `ell`) is logged once at start, listed under
  `ignored` and left out; if none is left, OCR is off and the log says why.
- **First use downloads each language's data** (`<code>.traineddata`, a few MB) from raw.githubusercontent.com, pinned
  to one commit of [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast), into the `agent_data` volume under
  `tessdata/`. A server with no way out: put the files there yourself. While a download fails the agent logs it and
  leaves OCR alone for a minute, then two, four and so on up to an hour, opening no PDF meanwhile (`problem` in
  `/agent/ocr` says why); the first download that works starts the reading.
- **It works in the background**, a page at a time on one core at low priority: every minute the agent looks for PDFs
  attached since and reads the scanned pages among each one's first 50 (what search indexes); a later page is read when
  the assistant asks for it, and a page the assistant is waiting for goes ahead of the rest. On a 4-core N100 a page
  takes 1 to 5 seconds. The first start after an upgrade reads the PDFs you already have.
- **What it reads well**: printed pages scanned flat. A photo of a page, a faint copy and handwriting come out poorly;
  the assistant is told which pages are OCR's and which of those read poorly, so it can say so instead of guessing.
- **What it keeps**: the text it read, in `ocr.sqlite` in the `agent_data` volume. It is derived: deleting it costs one
  re-read, and a PDF deleted from its note takes its text along within a minute.
- **Changing the languages** reads every scanned page again, in the new ones.
- **Turning it off**: `TEF_NOTES_OCR=` (empty) in `.env`, then `docker compose up -d`. A scanned PDF then has no text
  for the assistant or search, as a PDF the agent can't open has.
- **Not read**: photos (the assistant looks at a picture itself), and a PDF attached to a chat message rather than to a
  note (file it in a note first).

The agent's half: `agent/src/ocr.ts` (the queue and what was read), `agent/src/ocr-run.ts` (the process that draws a
page and runs Tesseract), `agent/src/pdfs.ts` (which pages are scans). The rest of the agent's pdf.js and canvas work (a PDF's text and tile
picture, a drawing's PNG) is `agent/src/render.ts`'s one child process, so a big PDF never stalls a chat.

## The write contract

Every write to a note or task carries the `rev` it was based on, and `pb_hooks/rev.pb.js` refuses it if the
record has moved since; clients re-read and merge instead of overwriting. Details in
[../ARCHITECTURE.md](../ARCHITECTURE.md).

## Custom HTTP routes

PocketBase's own `/api/collections/...` API serves the records. The hooks add the routes below; each answers a failure
as `{ error }` alone (`pb_hooks/lib/http.js`, held by `test/http.test.js`), which clients read with core `serverError`:

| Method | Path | What it does |
|---|---|---|
| `GET` | `/api/tefnotes/link-preview?url=` | Page title, description and picture for link cards, cached in `link_previews` (pruned daily). Fetches only public addresses, checked on every redirect hop. |
| `POST` | `/api/tefnotes/clip/suggest` | Ranks up to four notes and open tasks a page or picture fits (needs `typesafe`); writes nothing. |
| `POST` | `/api/tefnotes/clip/tags` | Scores every defined tag for a page and preselects the likely ones (needs `typesafe`); writes nothing. |
| `POST` | `/api/tefnotes/clip` | Saves a clip to a chosen note, task, new note or new task (its pictures and PDFs then in a new note the task links to): attachments, tidied note, optional summary. |
| `GET` | `/api/tefnotes/clip/image` | Fetches a public picture for the extension, through the same guard as link previews. |
| `POST` | `/api/tefnotes/tags/describe` | Drafts a tag's description (`{tag}`) or all tags' (`{all: true}`) from notes carrying it; returned, never saved. |
| `POST` | `/agent/chat` | Streams a chat turn (the agent sidecar, not PocketBase). |
| `GET` | `/agent/models` | Lists the provider's models and whether its key is present (the agent sidecar). |
| `POST` | `/agent/transcribe` | Voice input: raw mono 16 kHz float32 samples in, `{ text }` out, through Fish Audio. 404 without `TEF_NOTES_KEY_FISH`. Contract: `packages/core/src/voice.ts`. |
| `GET` | `/agent/ocr` | Scanned PDFs: whether they are read, in which languages, pages read and waiting, what failed (the agent sidecar; see Scanned PDFs). |
| `GET` | `/agent/push/key` | `{ publicKey }` a browser subscribes to push with; 404 while push is off (the agent sidecar). |
| `POST`, `DELETE` | `/agent/push/subscribe` | Stores a browser's `PushSubscription` (and a `label`), the same endpoint again replacing it, a new one beyond 20 devices a 409; `DELETE` takes `{ endpoint }`. Shapes: `packages/core/src/push.ts`. |
| `GET` | `/agent/companion/hello`, `/agent/companion/tasks?list=`, `/agent/companion/notes` | What the native companion (`android/`) draws: the owner's colours, a task list and the notes, ready to draw, under the lens on. Contract: `packages/core/src/companion.ts`. |
| `POST` | `/agent/companion/tasks`, `/agent/companion/tasks/:id/done` | The companion's two writes: a new task (`{ title, list? }`) and a tick, a repeating task rolled over. |

Cron jobs: `autotag` every minute (evaluates up to 50 notes per run, never-tried first; a note JEV keeps refusing backs off, `notes.tagFailed`), `tag-describe` hourly and `link_previews_prune` daily.

## Schema and migrations

`pb_migrations/` is the canonical schema, and it is append-only: a schema change is a new file, never an edit to one
that has been applied. Migrations and hooks are copied into the image (`Dockerfile`), never bind-mounted, because
PocketBase restarts on a hook change and applies every pending migration; a mounted checkout would deploy whatever was
saved. They reach the server with a new image only (`docker compose pull && docker compose up -d`, or `up -d --build`
from source). Migrations apply when PocketBase starts:

```sh
docker compose logs --tail 20 pocketbase    # migrations applied, no hook errors
```

## Deploy and verify

```sh
cd server
docker compose pull                         # the release in TEF_NOTES_VERSION (default: the latest)
docker compose up -d                        # recreates what changed: web, hooks, migrations, the agent
docker compose logs --tail 20 pocketbase    # migrations applied, no hook errors
docker compose logs --tail 20 agent         # "agent: listening", "agent: scanned PDFs are read by Tesseract (...)", no "not saved" lines
docker compose logs --tail 20 agent         # "agent: listening on 8098", and any speech it could not send to Fish
curl -s http://localhost:8097/api/health
curl -s http://localhost:8098/agent/models
curl -s http://localhost:8098/agent/ocr     # "on": true; "waiting" falls to 0 as the scanned pages are read
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/octet-stream' --data-binary '' http://localhost:8098/agent/transcribe   # 400: voice input on (404: no Fish key)
```

To check a provider key is present without printing it:

```sh
docker compose exec -T pocketbase test -s /run/llm/api-key && echo present
```

Auto-tagging check: a note's `tagged` field fills in within a minute or two of a typesafe key being present. Clip check:
`POST /api/tefnotes/clip/suggest` with `{"url":"https://example.com","title":"Test"}` lists suggestions and writes
nothing. A new tag definition or an edited description re-evaluates every note, at up to 50 a minute.

## Updating from the app

Settings → Maintenance shows the release the server runs and, when GitHub has a newer one, its notes and an **Update**
button. Every install gets the notice; the button needs the updater, an opt-in service, because it holds the Docker socket
(root on the host). Turn it on in `server/.env`:

```sh
COMPOSE_PROFILES=updater
```

then `docker compose up -d` from `server/` (the updater mounts that folder at its own path, `${PWD}`, so run compose from
there). It has no port on the host; only the agent reaches it, and it takes nothing but a release version. An update:

1. checks the version is a published release, newer than the one running;
2. pulls the release's three images (a failure here changes nothing);
3. stops PocketBase and tars `pb_data/` into `server/backups/` (the newest 3 kept, owned by root);
4. moves a pinned `TEF_NOTES_VERSION` in `.env` to the new version (unpinned stays on `latest`), recreates `pocketbase`
   and `agent` (migrations apply on start), then recreates itself from the new image.

The app reloads into the new web app once the server answers on the new version. It does not change your compose file:
when a release's notes say `docker-compose.yml` changed, update the file and run `docker compose up -d` yourself.
`TEF_NOTES_UPDATE_BACKUP=off` skips the snapshot (needed when `pb_data` is a named volume, not a folder). A server built
from source (`docker-compose.build.yml`) is never updated by the app: pull with git and rebuild. If an update fails, the
reason shows in Settings and in `docker compose logs updater`.

## Backups

`pb_data/` (SQLite database and uploaded files) is the only copy of your data, and the server does not back it up. Copy
it while the container is stopped (`docker compose stop pocketbase`), or use PocketBase's backup feature (admin UI,
Settings, Backups, or its backup API). Never run `docker compose down -v` or delete `pb_data/` without a copy.

## The browser extension's CRX

A locally built image serves a signed Chrome extension for self-hosted install and auto-update; the published one
serves none. `docker-compose.build.yml` is the overlay that builds from source (the `with-extension` target of the
`Dockerfile`) with your origin (`TEF_NOTES_URL`) and key, and without a key it still builds and serves no extension.
Build from a checkout of the release you run, with that release as `TEF_NOTES_VERSION` (Chrome installs an update only
when its version is higher).

```sh
cd server
openssl genrsa -out crx-key.pem 2048
echo 'TEF_NOTES_CRX_KEY=./crx-key.pem' >> .env
echo "TEF_NOTES_VERSION=$(sh ../scripts/version.sh)" >> .env
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

The same command, without a key, is how to build both images from source. To make it the default, put
`COMPOSE_FILE=docker-compose.yml:docker-compose.build.yml` in `.env` (and `:docker-compose.override.yml` if you have
one: Compose merges that file on its own only when `COMPOSE_FILE` is unset).

The key must live inside `server/` (Compose refuses a secret outside the build context) and is git ignored; it is a
BuildKit secret and never lands in an image layer. **Keep it**: the extension's ID is derived from the key, so a lost or
replaced key makes a different extension. `no-crx-key` is the empty placeholder that `TEF_NOTES_CRX_KEY` defaults to, so
Compose has a secret file to mount before you have a key; the build detects it is empty and skips the pack. `TEF_NOTES_URL`
must be your https origin for Chrome to install from it. Installing and the clip contract:
[../extension/README.md](../extension/README.md).

## Development

```sh
cd server/agent && bun install    # once
cd .. && bun test                 # hook-lib tests (test/) and the agent's
cd agent && bun run typecheck
```

The hooks' pure code lives in `pb_hooks/lib/` so bun can test it; a PocketBase handler runs in its own VM and sees none
of its file's top-level scope, so shared code is `require`d from `lib/`. What they use of the clients' TypeScript is
`lib/core.js`, a bundle of `pb_hooks/bundle/core.ts` (`bun pb_hooks/bundle/build.ts`; generated, never committed): the
image builds it, `bun test` here builds it first (`bunfig.toml`), and so does the integration runner. A hook needing more
of the core exports it there; only pure code, which build.ts enforces.

## Upgrading PocketBase

The version is the `PB_VERSION` build arg in `Dockerfile` (a default of `0.40.6`; the image is built for each
architecture from PocketBase's matching zip). Change it, read PocketBase's release notes for breaking changes, then
publish a new tag (the `Docker images` workflow) or, from source, rebuild. Back up `pb_data/` first: a new version may migrate its own system tables, and
there is no way back.

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml build --build-arg PB_VERSION=<new> pocketbase
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d   # or edit the ARG default
```

### Real PocketBase integration contract

From the repository root:

```sh
bun --no-env-file server/integration/run.ts
# Include application services, companion handlers and the chat saver (also used in CI).
bun install --frozen-lockfile --cwd server/agent
bun --no-env-file server/integration/run.ts --application
bun server/agent/node_modules/typescript/bin/tsc --project server/integration/tsconfig.json
# Optional: use an existing binary (must match server/Dockerfile's PB_VERSION).
TEF_TEST_POCKETBASE=/absolute/path/to/pocketbase bun --no-env-file server/integration/run.ts
```

Requires Bun, and `curl` + `unzip` when no PocketBase binary is supplied or on PATH. The runner reads the production
version from `Dockerfile`; downloads use that exact GitHub release and are checked against its published SHA-256
checksums. An existing binary with a different version fails explicitly. The default suite needs no package install;
`--application` also loads the agent's application services and needs its dependencies.

The runner builds the hooks' bundle, copies the repository migrations and hooks into a fresh temporary directory, starts PocketBase on an
OS-assigned `127.0.0.1` port, and tests the public shared client over HTTP. It uses an empty key directory and a minimal
child environment, never deployment configuration, production data, Docker Compose, or an existing server URL.
It stops its children and removes only its temporary directory on completion or handled interruption.

Coverage: notes/tasks rev compare-and-swap (missing/stale writes and deletes), noteColumns create/update round trips,
immutable note path/kind, link replay and relation uniqueness, invalid link shapes, cascades from either endpoint,
multipart attachments (bytes, unique names, download and deletion cleanup), and legacy/versioned chat history round trips.
`--application` adds service writes and cache refreshes, recurring tasks carrying links, companion add/tick handlers,
and versioned chat saving against that server. This checks actual PocketBase hooks and migrations, including the HTTP
errors the shared client maps to Conflict. It does not exercise external AI jobs, the sidecar HTTP listener,
upgrades of an existing database, or simultaneous competing writes.

The integration suites deliberately have no Bun test-discovery suffix. Ordinary `bun test` does not run them; the
runner creates a temporary test wrapper for this explicit command. CI runs it as the separate **PocketBase - HTTP
integration contract** job. Download, startup and assertion failures fail the job rather than silently skipping it.
