# TEF Notes server

<!-- reviewed: 2026-11-08 -->

The server half of TEF Notes, a self-hosted personal notes and tasks system: [PocketBase](https://pocketbase.io) with
JavaScript hooks (`pb_hooks/`) and migrations (`pb_migrations/`), plus a small bun sidecar that runs the chat agent
(`agent/`, see [agent/README.md](agent/README.md)). `docker compose up -d` pulls both as multi-arch (amd64, arm64)
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
- To build from source, or the extension: BuildKit (the signing key is a build secret) and the whole repository cloned,
  because the build context is the repo root (the web app, extension and agent share `packages/core` and the phone's assets).
- bun, only to run the tests (see Development).

## Quick start

```sh
cd server
cp .env.example .env              # then edit it: at least TZ
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

A failure is logged with its status, never the key. Auto-tagger and clip failures show as `autotag:` and `clip:` lines
in PocketBase's logs (admin UI, Logs).

## Push reminders

The installed web app gets a task's reminder (its `when` day and `remind` time) as a Web Push notification, sent by the
agent every minute; the phone app rings its own local ones. Set up once: generate a VAPID key pair with
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

## The write contract

Every write to a note or task carries the `rev` it was based on, and `pb_hooks/rev.pb.js` refuses it if the
record has moved since; clients re-read and merge instead of overwriting. Details in
[../ARCHITECTURE.md](../ARCHITECTURE.md).

## Custom HTTP routes

PocketBase's own `/api/collections/...` API serves the records. The hooks add:

| Method | Path | What it does |
|---|---|---|
| `GET` | `/api/tefnotes/link-preview?url=` | Page title, description and picture for link cards, cached in `link_previews` (pruned daily). Fetches only public addresses, checked on every redirect hop. |
| `POST` | `/api/tefnotes/clip/suggest` | Ranks up to four notes and open tasks a page or picture fits (needs `typesafe`); writes nothing. |
| `POST` | `/api/tefnotes/clip/tags` | Scores every defined tag for a page and preselects the likely ones (needs `typesafe`); writes nothing. |
| `POST` | `/api/tefnotes/clip` | Saves a clip to a chosen note, task, new note or new task (a picture then in a new note the task links to): attachment, tidied note, optional summary. |
| `GET` | `/api/tefnotes/clip/image` | Fetches a public picture for the extension, through the same guard as link previews. |
| `POST` | `/api/tefnotes/tags/describe` | Drafts a tag's description (`{tag}`) or all tags' (`{all: true}`) from notes carrying it; returned, never saved. |
| `POST` | `/agent/chat` | Streams a chat turn (the agent sidecar, not PocketBase). |
| `GET` | `/agent/models` | Lists the provider's models and whether its key is present (the agent sidecar). |
| `GET` | `/agent/push/key` | `{ publicKey }` a browser subscribes to push with; 404 while push is off (the agent sidecar). |
| `POST`, `DELETE` | `/agent/push/subscribe` | Stores a browser's `PushSubscription` (and a `label`), the same endpoint again replacing it, a new one beyond 20 devices a 409; `DELETE` takes `{ endpoint }`. Shapes: `packages/core/src/push.ts`. |

Cron jobs: `autotag` every minute (evaluates up to 50 notes per run) and `link_previews_prune` daily.

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
docker compose logs --tail 20 agent         # "agent: listening", no "not saved" lines
curl -s http://localhost:8097/api/health
curl -s http://localhost:8098/agent/models
```

To check a provider key is present without printing it:

```sh
docker compose exec -T pocketbase test -s /run/llm/api-key && echo present
```

Auto-tagging check: a note's `tagged` field fills in within a minute or two of a typesafe key being present. Clip check:
`POST /api/tefnotes/clip/suggest` with `{"url":"https://example.com","title":"Test"}` lists suggestions and writes
nothing. A new tag definition or an edited description re-evaluates every note, at up to 50 a minute.

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
of its file's top-level scope, so shared code is `require`d from `lib/`.

## Upgrading PocketBase

The version is the `PB_VERSION` build arg in `Dockerfile` (a default of `0.40.6`; the image is built for each
architecture from PocketBase's matching zip). Change it, read PocketBase's release notes for breaking changes, then
publish a new tag (the `Docker images` workflow) or, from source, rebuild. Back up `pb_data/` first: a new version may migrate its own system tables, and
there is no way back.

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml build --build-arg PB_VERSION=<new> pocketbase
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d   # or edit the ARG default
```
