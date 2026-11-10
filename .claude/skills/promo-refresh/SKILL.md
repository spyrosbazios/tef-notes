---
name: promo-refresh
description: Keep TEF Notes' promotional content (the root README.md and the public site in site/) in step with what the app actually does. Use after a release, when Spyros says the README or site is stale, on the scheduled weekly check, or when /promo-refresh is invoked.
---

# Promo refresh

The promo surface is the root `README.md` and `site/` (copy in `site/src/components/*.tsx`, the drawn screens in
`site/src/components/mock/`). It goes stale when features ship or get removed. This skill finds that drift and fixes it.

## 1. Find the range, or stop

The last refresh is the newest commit whose subject starts with `Promo:`.

```sh
last=$(git log -1 --format=%H --grep='^Promo:' main)
git log --oneline ${last:+$last..}main -- . ':!site' ':!README.md'
```

If nothing user-facing landed in that range (only refactors, tests, docs, chores), **stop**. Report "no drift" and
commit nothing. A scheduled run with no new commits must be a no-op.

Read `CHANGELOG.md` for the same range. It is the plain-language list of what shipped.

## 2. Find the drift

Check each user-visible claim against the code. Don't trust the README or the site, and don't trust memory either.

- **Missing:** a shipped feature worth a line that neither the README's feature list nor the site's `Features.tsx`,
  `Showcase.tsx` or `Fits.tsx` mentions.
- **Stale:** a claim about something removed or renamed. Example: the screenshot captures were removed, and the frozen
  Android app is no longer the phone client (the PWA is).
- **Wrong numbers or names:** versions, install commands, module names. Check these against the repo.

Rank what you find. Promo shows the strongest few features. It is not a changelog: never list every commit.

## 3. Apply

- **Copy** (text in the README and in the site's section components): edit it directly. Keep the existing voice,
  which is short, concrete and free of hype.
- **Mock screens** (`site/src/components/mock/`): they are drawn in React to match the real web app at
  `web/src/components/`, never as screenshots (`site/README.md`). Change a mock only when its screen visibly changed
  in a way the page relies on, such as a removed tab or a renamed view. A new feature that needs a new mock or `Peek`
  is a **proposal**: describe it in the report and don't build it unasked.
- Demo content stays fictional. Colours come from the page's tokens and icons from lucide. Paths go through Vite's
  `base`.

## 4. Verify

```sh
cd site && bun install && bun run build && bun run lint
SITE_BASE=/tef-notes/ bun run build
```

Then render `site/dist` with `html_preview`/`html_render` (or serve it with `bun run preview` under a pid file) and look at
every section you touched, at desktop width and at 390 px.

## 5. Commit and ship

One commit whose subject starts with `Promo:` (this is the marker step 1 reads), for example
`Promo: README and site cover places and voice input`. Merge it to main and push. GitHub Pages
(`.github/workflows/pages.yml`) republishes the site on a push to main that touches `site/`. Stop instead if the
live checkout is dirty.

## Report

Lead with what changed. Then list the proposed mock work, if any. Then the one next step.
