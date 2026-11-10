## What changed and why

## Modules touched
<!-- packages/core, server, server/agent, web, cli, extension, site, docs -->

## Checklist

- [ ] Schema change? It is a **new** file in `server/pb_migrations/`, never an edit to an existing one (or: no schema change).
- [ ] Tests and checks run for every module touched, and for `packages/core` if it changed (list them below).
- [ ] No secrets, `.env`, key files or `pb_data/` in the diff.
- [ ] I have signed the CLA (see CLA.md; the bot asks on a first PR).

## Tests run
<!-- e.g. `cd server && bun test`, `cd packages/core && bun test && bun run typecheck` -->

<!-- PRs are squash-merged, so the PR title becomes the commit message. CI must pass before merge. -->
