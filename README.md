# TEF Notes

<!-- reviewed: 2026-11-07 -->

> **There is no sign-in.** Anyone who can reach the server's port can read, write and delete every note, task and
> attachment. Never expose it to the public internet: no port forward, no public proxy. Reach it only through a reverse
> proxy on a private network (Tailscale or similar). Read [SECURITY.md](SECURITY.md) before you deploy.

**TEF Notes** is a personal notes and tasks system you host yourself. Notes are
markdown files with a little frontmatter, kept on a server you run; an Android app, a web app, a terminal client and a
Chrome clipper all read and write them. Tasks work the way Things does. A chat agent can search, read and
edit your notes and tasks (and ask before it writes), and an optional auto-tagger files notes under your tags.

## Features

- **Notes**: markdown with frontmatter (`title`, `tags`, `color`, `pinned`), checkboxes, tables, code, links with
  previews and a Reader view (the linked article, clutter gone), photos, PDFs and Excalidraw drawings. Notes can be in any language.
- **Tasks**: Inbox, Today, This Evening, Upcoming and Logbook views; checklists, due dates, reminders and
  repeating tasks (`2w`, `+3d`, `mon,thu`).
- **Offline-first phone app** (Android): SQLite cache, background sync, home and lock screen widgets, and a
  field-level merge when two devices edited the same thing.
- **Web app** for the laptop, served by the same server, with the same editor as the phone.
- **Chat agent**: an assistant in its own Ask tab on the phone and a dock on every web screen; it sees the page you are
  on, answers over your notes, adds and edits notes and tasks through confirm cards, and optionally searches the web. It keeps a small memory of how you work.
- **MCP server** (optional, off by default): hand your notes and tasks to another agent harness, such as Claude Code,
  Codex or Cursor, with the same tools and write safety as the chat agent. See [server/agent/README.md](server/agent/README.md#mcp-the-tools-for-another-agent-harness).
- **Auto-tagging**: a background job adds the tags it is sure of and offers the ones it is not.
- **Browser clipper**: save a page or a picture to a new note, an existing note or a task, with suggestions for where
  it fits and an optional summary.
- **CLI** (`tefnotes`): read, append, edit and export notes and tasks from a terminal or a coding agent. Every write
  is compare-and-swap, so it never overwrites an edit it has not seen.
- English UI. Titles in other scripts (Greek, for one) are transliterated for file names.

## Security model: read first

**There is no sign-in.** Every collection is open (`server/pb_migrations/1792400000_open.js`): anyone who can reach the
server's port can read, write and delete every note, task and attachment. The design leaves access control to the
network:

- The server binds to loopback only (`127.0.0.1`).
- Your devices reach it through a reverse proxy on a **private network** (the author uses
  [Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve) over HTTPS).
- **Never expose it to the public internet**: no port forward, no public reverse proxy, no Tailscale Funnel.

See [SECURITY.md](SECURITY.md) for what that means in practice and how to report a vulnerability.

## Layout

| Directory | What it is | Docs |
|---|---|---|
| `packages/core/` | Dependency-free TypeScript shared by every client: note format, 3-way merge, PocketBase client, task logic, agent card shapes, theme palettes. Imported everywhere as `@/core/*` | [ARCHITECTURE.md](ARCHITECTURE.md) |
| `server/` | PocketBase with JS hooks and migrations; `server/agent/` is the chat agent (a bun sidecar that streams). One `docker compose up -d` pulls the published images; the signed extension needs a build from source | [server/README.md](server/README.md) |
| `web/` | The web app (Vite, React, shadcn). Also builds the phone's editor and PDF viewer pages | [web/README.md](web/README.md) |
| `mobile/` | The Android app (Expo, React Native, offline-first, pnpm 11) | [mobile/README.md](mobile/README.md) |
| `cli/` | The `tefnotes` command-line client (bun) | [cli/README.md](cli/README.md) |
| `extension/` | The Chrome (MV3) clipper, packed as a signed CRX the server serves | [extension/README.md](extension/README.md) |
| `site/` | The public marketing page: a static Vite build, deployed on its own | [site/README.md](site/README.md) |

How the pieces fit, the note format and the write contract: [ARCHITECTURE.md](ARCHITECTURE.md).

## Quick start

Clone the whole repository: every module imports `packages/core`.

```sh
git clone https://github.com/spyrosbazios/tef-notes.git tefnotes && cd tefnotes/server
cp .env.example .env              # set TEF_NOTES_URL to the address your devices will use (and TZ)
mkdir -p keys/deepseek            # optional AI keys: one api-key file per provider, see below
cp /path/to/key keys/deepseek/api-key
docker compose up -d              # pulls the published images (server + web app, and the agent); build from source: server/README.md
```

Then:

1. Put a reverse proxy on a private network in front of the two loopback ports (`PB_PORT`, default 8097, serves the
   API and the web app; `AGENT_PORT`, default 8098, serves the chat agent under `/agent` on the same origin).
   `TEF_NOTES_URL` is that origin. Chrome installs an extension only from https, so use https if you want the clipper.
2. Open the web app at `TEF_NOTES_URL`.
3. Install the Android app from the APK you build following [mobile/README.md](mobile/README.md), and enter your URL.
4. Point the CLI at it with `bun cli/tefnotes.ts server <url>` ([cli/README.md](cli/README.md)).
5. Install the extension as described in [extension/README.md](extension/README.md).

Want an AI agent to do this for you? Give it the [self-host skill](skills/self-host/SKILL.md).

Server configuration, the extension's signing key and the deploy checks are in [server/README.md](server/README.md).

## AI providers

All optional. Each key is a file `server/keys/<provider>/api-key` holding the key alone (or a directory you name in
`server/.env`, see `server/.env.example`). Keys are mounted read-only and re-read on every use, so a new key needs no
restart. The model provider is your choice; see below.

| Provider | Powers | Without it |
|---|---|---|
| `typesafe` (JEV, a vision and ranking model) | Auto-tagging and the clipper's suggestions of where a page fits | Neither does anything; you can still save a clip to a note you pick or a new one |
| The model provider (`TEF_NOTES_PROVIDER`, below) | The chat agent, the clipper's write-up and optional summary, tag descriptions | The chat is unavailable; a clip is saved as you typed it, without a summary |
| `exa` | The chat agent's web search | The agent has no web tools |

One model provider per server, chosen with `TEF_NOTES_PROVIDER` in `server/.env` (default `deepseek`); its key goes in
`server/keys/<provider>/api-key`. `TEF_NOTES_MODEL` picks another of its models; the app's model picker lists them all.

| `TEF_NOTES_PROVIDER` | Default model | Key from |
|---|---|---|
| `deepseek` | `deepseek-flash` | platform.deepseek.com |
| `anthropic` | `claude-sonnet-5-5` | console.anthropic.com |
| `openai` | `gpt-6-luna` | platform.openai.com |
| `xai` (Grok) | `grok-4.7` | console.x.ai |
| `qwen` | `qwen-plus` | Alibaba Cloud Model Studio (international; `TEF_NOTES_LLM_URL` for another region) |
| `zai` (Z.ai, GLM) | `glm-5.3` | z.ai |
| `ollama` | none: set `TEF_NOTES_MODEL` | no key: set `TEF_NOTES_OLLAMA_URL` (`http://host.docker.internal:11434` for one on the same host) |

Switching provider: set `TEF_NOTES_PROVIDER`, put the key in `server/keys/<provider>/api-key`, then
`docker compose up -d` (the variables apply when the containers are recreated). A model that calls tools reliably
matters for the chat; a small local model may not.

Whatever you send to a provider leaves your server: note text, photos the auto-tagger looks at, pages you clip. Leave
a key out to keep that feature off.

## Backups

TEF Notes ships no backup tooling. `server/pb_data/` is the whole database and its attachments; if you lose it, your
notes are gone. Back it up yourself, either with PocketBase's backup API (from the admin dashboard at `/_/`, or
scheduled there) or by copying the directory with the containers stopped (`docker compose stop`). Test a restore once.

## Development

Each module documents its own setup, checks and build steps:

- `packages/core`: [ARCHITECTURE.md](ARCHITECTURE.md); `cd packages/core && bun test && bun run typecheck`
- `server`: [server/README.md](server/README.md); tests with `cd server && bun test` (the agent's included)
- `web`: [web/README.md](web/README.md); tests with `bun test`
- `mobile`: [mobile/README.md](mobile/README.md); tests with `pnpm test`
- `cli`: [cli/README.md](cli/README.md)
- `extension`: [extension/README.md](extension/README.md)

See [CONTRIBUTING.md](CONTRIBUTING.md) before sending a change. `AGENTS.md` is for AI coding agents working in the repo.

## Screenshots

<!-- screenshots: add docs/screenshots/*.png -->

## License

AGPL-3.0, see [LICENSE](LICENSE). Contributions need a one-time CLA ([CONTRIBUTING.md](CONTRIBUTING.md#licence-and-cla)). The phone app's font, Atkinson Hyperlegible, is under the SIL Open Font License
(`mobile/assets/fonts/OFL.txt`).
