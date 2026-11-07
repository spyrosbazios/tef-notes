# @tefnotes/core

<!-- reviewed: 2026-11-04 -->

The code every TEF Notes client shares: the phone, the web app, the CLI, the extension and the chat agent. Dependency-free
TypeScript; how it fits the rest is in [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md).

## What is in `src/`

| Files | Hold |
|---|---|
| `notes.ts`, `note-groups.ts`, `links.ts`, `photos.ts`, `task-notes.ts` | The note file format (parse, serialize, ids, paths), 3-way merge, grouping, pasted links' titles and photos |
| `record-links.ts` | Links between records (`links`): types, wire columns, a task's notes, a note's backlinks |
| `todo.ts`, `things.ts`, `today.ts`, `bulk.ts`, `dates.ts`, `time.ts`, `home-sections.ts` | Tasks: types, patches, ticking and repeats, the field-level merge, the smart views |
| `pocketbase.ts`, `http.ts`, `tags.ts`, `types.ts` | The PocketBase client with the `rev` compare-and-swap, shared types, tag calls |
| `assistant.ts` | The always-on assistant's contract: the page context a client sends with each message, and the UI tools (`open_note`, `open_task`, `go_view`) the client does itself |
| `agent.ts`, `clip.ts`, `share.ts`, `handoff.ts` | The chat agent's card shapes and wording, the clip contract, share-to-agent, "Ask about this" |
| `theme.ts`, `page-theme.ts` | The palettes: the one home of colour |
| `brand.ts` | The brand mark's outline, generated from `mobile/assets/logo` by `mobile/scripts/icons.ts` |
| `editor-bridge.ts`, `pdf-bridge.ts` | Messages between the phone and its WebView pages |

## Rules

- No dependencies: plain TypeScript, no `package.json` dependencies, and no imports from React, React Native or `node:`, so every runtime can import it.
- No second copy elsewhere: a client that needs note, task or merge logic imports it from here.

## Using it

Consumers import it as `@/core/*`:

- TypeScript: each module's `tsconfig.json` maps `"@/core/*"` to `../packages/core/src/*` under `paths`.
- Vite (web, site, extension): an alias for `@/core/` to `CORE_SRC` from `packages/core/vite.ts`, which also holds the
  two build plugins they share: the palette as `--tf-*` CSS variables (`virtual:tefnotes-theme.css`) and the tab's icon and
  manifest. Build-time Node code, outside `src/`, typed without importing vite so the core stays dependency-free.
- Metro (phone): `watchFolders` includes `packages/core` (`mobile/metro.config.js`).
- Docker images copy `packages/core` beside the module they build.

## Tests

```sh
cd packages/core
bun install
bun test
bun run typecheck
```
