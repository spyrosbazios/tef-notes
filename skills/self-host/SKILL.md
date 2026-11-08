---
name: self-host
description: Install, deploy, set up, run or self-host TEF Notes (PocketBase server plus bun chat agent in Docker), put it behind a private reverse proxy, and install the web app on a phone, or point the CLI or the Chrome extension at the server. Use when the user wants to host their own TEF Notes, upgrade it, or connect a device to it.
license: AGPL-3.0
compatibility: Needs Docker with Compose v2 and network access to ghcr.io (or git, to build from source). Written for Linux hosts; Tailscale or Caddy for the proxy.
---

# Self-host TEF Notes

Repo: `https://github.com/spyrosbazios/tef-notes`. Depth lives in `server/README.md`; this skill holds the commands.
Helpers: `scripts/check.sh` (preflight), `scripts/verify.sh [origin]` (health checks). Run commands from `server/`.

## Hard rules (read first, they are not optional)

> - **There is no sign-in.** Anyone who reaches PocketBase or the agent can read, write and delete every note.
>   NEVER bind either beyond loopback, never edit the compose file to `0.0.0.0`, never expose it publicly (no port
>   forward, no public tunnel, no Tailscale Funnel). A reverse proxy on a **private network** is the only way in.
> - NEVER `docker compose down -v`, delete `server/pb_data/`, or prune its volumes: it is the only copy of the notes.
> - There are **no backups** unless the owner sets them up. Do not set one up or propose one unless they raise it.
> - Never write a note or task without the `rev` it was based on; the server refuses it. Re-read and redo.
> - Never run `sudo` yourself if the host forbids it: print the command for the owner. Never ask for an API key in
>   chat, never read key files, never write a key into a file yourself.

## 1. Docker check

```sh
sh scripts/check.sh      # or by hand:
docker --version && docker compose version     # Compose must be v2 ("Docker Compose version v2.x")
docker info >/dev/null && echo ok              # works without sudo, else: sudo usermod -aG docker $USER, re-login
ss -ltn | grep -E ':(8097|8098)\b'             # no output = ports free
```

If a port is taken, set `PB_PORT` / `AGENT_PORT` in `.env` in step 2.

## 2. Get the files

Clone (needed for the CLI, the extension and building from source):

```sh
git clone https://github.com/spyrosbazios/tef-notes.git tefnotes && cd tefnotes/server
cp .env.example .env
```

Pull-only alternative: download just `server/docker-compose.yml` and `server/.env.example` from the repo into one
directory and `cp .env.example .env`. Every variable has a default; edit `.env` for what differs:

| Variable | Meaning |
|---|---|
| `TZ` | IANA zone (`Europe/Athens`); notes the server writes are dated by this day. Default `UTC` |
| `TEF_NOTES_PROVIDER` | Model provider for the chat agent: `deepseek` (default), `anthropic`, `openai`, `xai`, `qwen`, `zai`, `ollama` |
| `TEF_NOTES_MODEL` | Model name; empty = the provider's default; Ollama has none, name a pulled model |
| `TEF_NOTES_LLM_URL`, `TEF_NOTES_OLLAMA_URL` | Provider API root override; Ollama's address (`http://host.docker.internal:11434` for the Docker host) |
| `TEF_NOTES_KEY_TYPESAFE`, `TEF_NOTES_KEY_LLM`, `TEF_NOTES_KEY_EXA` | Key directories (step 3). Defaults `./keys/typesafe`, `./keys/<provider>`, `./keys/exa` |
| `PB_PORT`, `AGENT_PORT` | Host ports, loopback only. Defaults `8097`, `8098` |
| `TEF_NOTES_URL` | The public origin devices use, i.e. the proxy's address (step 5). Not the loopback one |
| `TEF_NOTES_VERSION` | The version of the images/builds; see its comment in `.env.example` |
| `TEF_NOTES_KEY_PUSH`, `TEF_NOTES_VAPID_SUBJECT` | Task reminders as push notifications on the phone: the key directory (default `./keys/push`) and a `mailto:` contact. Empty subject = off. Set `TZ` too. Steps: `server/README.md#push-reminders` |
| `TEF_NOTES_MCP` | `1` serves the note and task tools at `/agent/mcp` for another agent harness (default `0`) |
| `TEF_NOTES_CRX_KEY` | Extension signing key path, inside `server/` (step 7). Default `./no-crx-key` = no extension |

`docker compose config` renders the result.

## 3. Keys (all optional)

Each key is a file `api-key` holding the key alone, in its own directory. Create the directories before the first
`up`, or Docker creates them root-owned:

```sh
mkdir -p keys/typesafe keys/deepseek keys/exa keys/push   # keys/<provider> for another TEF_NOTES_PROVIDER
chmod 644 keys/*/api-key                            # the containers run as uid 1000 and must be able to read them
```

| Directory | Enables | Without it |
|---|---|---|
| `keys/<provider>/api-key` | Chat agent, clipper write-up and summary, tag descriptions | Chat refused; models `available: false` |
| `keys/typesafe/api-key` | Auto-tagging, the clipper's "where does this fit" suggestions | Nothing auto-tagged; clips still save |
| `keys/exa/api-key` | The agent's web search and page reading | Agent runs without web tools |
| `keys/push/api-key` | Task reminders as push notifications to the installed web app (the VAPID private key, with `TEF_NOTES_VAPID_SUBJECT`) | Reminders do not ring; the agent logs "web push is off" |

Ollama needs no key. **The agent never asks for a key value in chat and never writes one.** Tell the owner:
"Put your key, alone, in `server/keys/<provider>/api-key` (e.g. `printf '%s' '<key>' > ...`, or paste it in an
editor), `chmod 644` it." Keys are re-read on every use: a new key needs no restart. Whatever a provider receives
(note text, photos, clipped pages) leaves the server; a missing key keeps that feature off.

## 4. Start

Default, pulls the published images `ghcr.io/spyrosbazios/tef-notes` and `ghcr.io/spyrosbazios/tef-notes-agent`:

```sh
docker compose up -d
```

From source (build the images yourself; needs the whole repo; this is also the only way to get the extension):

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

`-f` disables the automatic merge of `docker-compose.override.yml`; list it too if you use one.

```sh
docker compose logs --tail 20 pocketbase    # migrations applied, no hook errors
docker compose logs --tail 20 agent         # "agent: listening on 8098", no "not saved" lines
```

Optional admin UI login at `/_/` (the owner runs this and chooses the password):

```sh
docker compose exec pocketbase ./pocketbase superuser create <email> '<password>'
```

## 5. Reverse proxy (private network only)

Both ports bind `127.0.0.1` on purpose. One origin serves both: `/` goes to `PB_PORT`, `/agent` to `AGENT_PORT`.
**Put that origin in `TEF_NOTES_URL`** in `.env`, then `docker compose up -d` to apply it.

**Tailscale** (HTTPS on the tailnet). Serve strips the mount path, so repeat `/agent` in the target
([issue #6571](https://github.com/tailscale/tailscale/issues/6571)); the agent's routes are `/agent/chat`, `/agent/models`:

```sh
tailscale serve --bg --https=443 http://127.0.0.1:8097
tailscale serve --bg --https=443 --set-path=/agent http://127.0.0.1:8098/agent
tailscale serve status                      # then TEF_NOTES_URL=https://<host>.<tailnet>.ts.net
```

Use `--https=<port>` for another port and put it in `TEF_NOTES_URL`. Never `tailscale funnel`.
Docs: <https://tailscale.com/docs/reference/tailscale-cli/serve>.

**Caddy** on a host that is only on a private network (VPN, LAN you control). `bind` keeps it off public interfaces:

```
notes.example.internal {
    bind <private-ip>
    tls internal
    handle /agent/* {
        reverse_proxy 127.0.0.1:8098 {
            flush_interval -1
        }
    }
    handle {
        reverse_proxy 127.0.0.1:8097
    }
}
```

`handle` keeps the `/agent` prefix (do not use `handle_path`). `TEF_NOTES_URL=https://notes.example.internal`.
Devices must trust Caddy's local CA for `tls internal`. Check from another LAN machine that 8097/8098 are not what you
meant to publish: Docker's published ports can bypass some host firewalls.

## 6. Verify

```sh
sh scripts/verify.sh                          # loopback
sh scripts/verify.sh https://<proxy-origin>   # the path clients take
# by hand:
curl -s http://localhost:8097/api/health
curl -s http://localhost:8097/ | grep '<title>'
curl -s http://localhost:8098/agent/models    # "available": true when the model provider's key is read
docker compose exec -T pocketbase test -s /run/llm/api-key && echo present   # key present, value not printed
```

Success: health answers, `/` returns the web app's HTML, and opening the proxy origin in a browser shows the app
with an empty notes list and no sign-in. Auto-tagging shows a note's `tagged` field filling within a minute or two of a
typesafe key being present.

## 7. Point the clients

- **Phone (the installed web app)**: on Android, open `https://<proxy-origin>` in Chrome and choose Install app (the menu, or
  Chrome's prompt). Installing needs HTTPS, which the Tailscale Serve or Caddy step 5 gives; an `http://` address only opens in
  the browser. The app then works offline, is in the Share sheet of other apps, and can ring task reminders once the
  owner has set up push (`server/README.md#push-reminders`: a VAPID key in `keys/push/api-key` made by the owner, never by
  the agent; `TEF_NOTES_VAPID_SUBJECT`; `TZ`), then turns them on in Settings, Reminders, per device. The older Android
  app (`mobile/README.md`) is kept for 0.3.0 but gets no new features; do not install it for a new setup.
- **CLI** (needs [bun](https://bun.sh) and the cloned repo):
  ```sh
  cd cli && bun install
  bun tefnotes.ts server https://<proxy-origin>      # checks the address, saves it to ~/.local/state/tefnotes/server.json
  bun tefnotes.ts ls
  ```
- **Chrome extension**: only if the owner builds it with a key. `openssl genrsa -out crx-key.pem 2048` in `server/`,
  `TEF_NOTES_CRX_KEY=./crx-key.pem` in `.env`, an https `TEF_NOTES_URL`, then the from-source `up --build` of step 4.
  Keep the key (the extension ID derives from it). Policy install steps: `extension/README.md`. Unpacked: `cd extension
  && bun install && bun run build`, load `extension/dist`, enter the server address in its options page.
- **Web app**: open `TEF_NOTES_URL`.

## 8. Troubleshooting

- **Chat says unavailable / `"available": false`**: the model provider's key is missing, empty or unreadable by uid 1000.
  `ls -l keys/<provider>/api-key`, `chmod 644`, re-run the `test -s` check. Provider mismatch: `TEF_NOTES_PROVIDER`
  must match the directory name.
- **No extension served**: the default image holds none. It is built only with a signing key via the build overlay.
  `docker compose logs`/build output shows a `crx:` line, or says there is no key.
- **A key directory is root-owned, or the key not read**: the directory was created by Docker. Fix ownership/mode
  yourself (hand the owner the `sudo chown` if needed), then `docker compose up -d`.
- **Migrations**: PocketBase applies every pending migration on start. Never edit an applied one; schema changes are new
  files. Read `docker compose logs --tail 20 pocketbase` after every upgrade.
- **Changed `.env`, nothing happened**: variables apply when containers are recreated: `docker compose up -d`, not `restart`.
- **Upgrade**: `git pull && docker compose pull && docker compose up -d` (from source: re-run the build command).
  An unbacked-up `pb_data/` has no way back after a PocketBase upgrade.
