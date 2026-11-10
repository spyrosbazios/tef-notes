# Contributing

<!-- reviewed: 2026-11-10 -->

Thanks for looking. Read [ARCHITECTURE.md](ARCHITECTURE.md) first; it explains the note format and the write contract
that most changes have to respect. Security reports go through [SECURITY.md](SECURITY.md), not issues.

## Layout

| Directory | What it is |
|---|---|
| `packages/core/` | Dependency-free TypeScript shared by every client, imported as `@/core/*` |
| `server/` | PocketBase hooks and migrations; `server/agent/` is the chat agent |
| `web/` | The web app; on a phone, the installed PWA |
| `cli/` | The `tefnotes` command |
| `extension/` | The Chrome clipper |
| `site/` | The public marketing page |
| `assets/` | Fonts, the logo SVGs, the app icon |

Clone the whole repository: every module imports `packages/core`.

## Rules

- **`packages/core` stays dependency-free and shared.** No runtime dependencies, no platform APIs. If two clients need the
  same logic, it goes there; never copy it into a client. (`server/pb_hooks/lib/notes.js` is the one deliberate copy,
  because hooks are plain JS, and a test keeps it in step.)
- **Package managers are fixed per module**: bun everywhere (`packages/core`, `server/agent`, `web`, `cli`, `extension`). Do not add a second lockfile to a module.
- **`web/src/components/ui/` is shadcn's output.** Add components with `bunx --bun shadcn@latest add <name>`; never
  hand-edit them.
- **Migrations are append-only.** A schema change is a new file in `server/pb_migrations/`; never edit one that has
  applied. Hooks and migrations are baked into the image and reach a server only with `docker compose up -d --build`.
- **Every write carries `rev`.** Never write a note or task without the `rev` it was based on, and on a refusal
  re-read and merge rather than retrying with the newer `rev`. The server hook enforces it; clients must respect it.
- **No secrets in the tree.** Provider keys live in `server/keys/` and `server/.env`, signing keys are `*.pem`; all are
  gitignored. Never commit `pb_data/`.
- **No new colours of your own.** Components, the extension and charts use the palette in `packages/core/src/theme.ts`.
- Fix lint and type errors rather than silencing them (`eslint-disable`, `@ts-ignore`).

## Running the checks

Each module's README has its setup and commands:

- `packages/core`: `cd packages/core && bun test && bun run typecheck`
- `server` (hooks and the agent): [server/README.md](server/README.md); `cd server && bun test`
- `web`: [web/README.md](web/README.md)
- `cli`: [cli/README.md](cli/README.md)
- `extension`: [extension/README.md](extension/README.md)

Run the checks of every module you touched, and of `packages/core` if you changed it (all clients depend on it).
Format, then lint, type-check, test and build, in that order.

Commit messages: short and descriptive, no required format. Keep unrelated changes in separate commits.
Pull requests are squash-merged once CI (`.github/workflows/ci.yml`) is green; there is no commit linter and no git hook.

## Licence and CLA

The project is under the [GNU AGPL-3.0](LICENSE): free to use, change and self-host; anyone who serves a modified
version over a network must publish their changes. The maintainer may also offer a paid hosted version.

So that contributions can go into both, every contributor signs the [Contributor License Agreement](CLA.md) once:
on your first pull request, a bot asks you to comment the sentence it quotes. You keep the copyright in your work.

## Versioning

The whole repository has one semver version, and the git tag is its only source: nothing stores it in a `package.json`.
`scripts/version.sh` prints it (`TEF_NOTES_VERSION` if set, else the latest tag without its `v`, else `0.0.0`), and the
extension's manifest reads it from there.

To release: move the `## Unreleased` entries of `CHANGELOG.md` under `## X.Y.Z - date`, commit to `main`, then tag
`vX.Y.Z` and push the tag. `.github/workflows/release.yml` builds the extension zip and attaches it to a GitHub release
whose notes are that changelog section; `docker.yml` publishes the server images.
