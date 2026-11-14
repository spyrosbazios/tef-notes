# TEF Notes film

The promo film: about half a minute, 1920 × 1080, silent, captioned. It is code, rendered by
[Remotion](https://www.remotion.dev), and it draws the screens the site draws (`../site/src/components/mock/`), so a
screen changed there is changed here. Nothing is recorded and no video file is committed.

- `bun install`, then `bun run stills` (three moments of every scene, half size, in `out/stills/`), `bun run stills Ask`
  (every half second of one scene), `bun run film` (`out/film.mp4` and its still, `out/film-poster.jpg`), `bun run studio`
  (Remotion's preview, to scrub through it). `bun test`, `bun run typecheck`, `bun run lint`.
- `scripts/render.ts` takes `--theme=<name>` (any theme of `../packages/core/src/theme.ts`; the default is the app's),
  `--scale=0.5` and `--concurrency=2`. The first run downloads Remotion's headless Chrome into `node_modules/.remotion`.
  A full render takes about two minutes on four slow cores and wants 1 to 2 GB; on a small machine run it capped.

## How it is put together

- **The script is data.** `src/storyboard.ts` is the film: the opening, the shots (a scene, its eyebrow and caption, its
  seconds, its slot, the release it is `since`, and `why` it holds the slot) and the closing. `RULES` there is the budget:
  36 seconds, 4 pinned scenes, 2 rotating ones, a scene of 3 to 6 seconds, a caption of 7 words. `test/storyboard.test.ts`
  holds the storyboard to it, so a cut that breaks a rule fails before anything renders.
- **A scene is one file** in `src/scenes/`, named in `src/scenes/index.ts`. It takes its shot and draws one thing: a
  layout (`Split`, `Wide`), a site screen in its frame, and a few moves with their times.
- **The kit** (`src/kit/`) is the whole vocabulary. `clock.ts`: a scene's time, with `ramp`, `after` and `typed`.
  `moves.tsx`: `Enter` (a device comes on), `Arrive` (a piece appears), `Tap` (a press on the control a screen marks
  `data-tap`, found on the page each frame). `Scene.tsx`: the layouts and the caption. `Stage.tsx`: the ground, in a theme.
- **A screen is driven through its props.** The site's mocks take what a scene changes over time, defaulting to what the
  page shows: `ClipperPopup`'s `note`, `PhoneTasks`' `tasks`, `AskDock`'s `turn` and `draft`.

## Invariants

- Every frame is a function of its time alone: no CSS transition or animation, no timer, no `Math.random()`. Remotion
  draws frames out of order, in several tabs; one that depends on what came before it comes out wrong.
- No screen, colour, font or icon of the film's own: the screens are the site's, the palette `@/core/theme` (through the
  site's `scoped`), the faces and the look `../site/src/look.css`, the icons lucide's.
- `@/` here is the **site's** source (`tsconfig.json`, `bundler.ts`), because the film compiles the site's files; the
  film's own files import each other by relative path. Every bare import, from either tree, resolves in this module's
  `node_modules`, so there is one React; the test keeps the shared packages at the site's version ranges.
- Remotion's licence is its own (`node_modules/remotion/LICENSE.md`): free for an individual and for a company of up to
  three, a paid company licence above that.

## Where it goes

`.github/workflows/film.yml` renders it, cached under a key of everything it is drawn from. `pages.yml` calls that and
makes the film the site's hero; `release.yml` calls it and attaches `tef-notes-film-X.Y.Z.mp4` to the
release. What a release changes in the cut is `.claude/skills/promo-video/SKILL.md`.

<!-- reviewed: 2026-11-14 -->
