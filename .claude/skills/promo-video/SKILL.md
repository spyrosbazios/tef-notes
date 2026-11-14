---
name: promo-video
description: Re-cut TEF Notes' promo film (video/) for what shipped - decide which scenes stay, which leave and which words change, edit the storyboard, build a new scene when one has earned a slot, check the frames, commit. Use after a release (the release skill runs it), on the scheduled weekly check, when Spyros says the film or promo video is stale or wants a scene changed, or when /promo-video is invoked.
---

# Promo video

The film is `video/`. Its script is data: `video/src/storyboard.ts` lists the scenes, their order, length and words, and
`RULES` there is the budget they are cut to. A scene is one file in `video/src/scenes/`, made of the moves in
`video/src/kit/` over the site's drawn screens (`site/src/components/mock/`). Nobody edits a video file: you edit the
storyboard, and CI renders it. The module's layout is `video/README.md`.

## 1. Find the range, or stop

The last cut is the newest commit whose subject starts with `Video:`.

```sh
last=$(git log -1 --format=%H --grep='^Video:' main)
git log --oneline ${last:+$last..}main -- . ':!video'
```

Read `CHANGELOG.md` for the same range. If nothing in it is something a user sees on a screen, **stop**: report "no
change" and commit nothing. A scheduled run with no new commits must be a no-op.

A change to `site/src/components/mock/`, `site/src/look.css` or `packages/core/src/theme.ts` in the range has already
changed the film (the push re-rendered it). The storyboard may need nothing, but do step 5: a move may no longer fit
the screen it was timed for.

## 2. Decide

Answer these in order. Check every claim against the code (`web/src/components/`), not against memory or the README.

**What leaves.** For each shot in `STORYBOARD`: does the app still do what the scene shows, the way it shows it? A
feature under `Removed`, or one renamed or reshaped, means the scene leaves or is corrected. This is not optional and
does not wait for a replacement.

**What could come in.** The candidates are the range's `Added` entries. One qualifies only if all of these hold:

- a user sees it on one screen (not a route, a hook, the agent's internals, a fix, a speed-up, self-hosting plumbing)
- its whole story is one action (something typed, pressed, ticked or arriving) that plays in 6 seconds or less
- a caption of 7 words or fewer says it, with nothing left to explain
- it matters to someone who has never run the app

Most releases have no candidate that qualifies. That is the normal result, not a failure.

**Which slot.** The budget is fixed: 36 seconds, 4 pinned scenes, 2 rotating. The pinned scenes are what the app is
(both screens, capture, the assistant, tasks) and change only when the app's own centre does. A candidate competes for
a rotating slot against the two shots holding one: read each one's `why` and `since`. It takes the weaker one's slot
only if it is stronger on how much changes on screen, how many people would care, and how new it is. If it is not,
nothing changes, and the report names the candidate and why it lost. Never make the film longer, never add a scene
beyond the slots, never cut a scene under `RULES.scene.min` to fit another in.

**Which words change.** Re-read every eyebrow and caption against the app. A number in a caption is checked against
the code ("Sixteen themes" is `THEME_NAMES.length`). `OPENING` is the site's hero headline and `CLOSING` the README's
first line: if `promo-refresh` changed those, change these.

## 3. Edit the storyboard

A re-cut that uses the scenes there are is an edit to `video/src/storyboard.ts` and nothing else: order, `seconds`,
`eyebrow`, `caption`, `since` (a release heading of `CHANGELOG.md`) and `why`. Write `why` for the next run: it is
what a newcomer will be weighed against. The voice is the site's: short, concrete, no hype.

## 4. Build a scene, when one has earned a slot

- A new file `video/src/scenes/<Name>.tsx`, its entry in `SCENES` (`scenes/index.ts`), its shot in the storyboard. The
  scene that left loses its file and its entry in the same commit: no unused scene is kept.
- A scene is a layout (`Split`: the words left, one device right; `Wide`: the words on top, a wide shot under them), a
  site screen in its frame (`PhoneFrame`, `BrowserFrame`, `Peek`), and moves: `Enter`, `Arrive`, `Tap`, and the clock's
  `typed`, `after` and `ramp`. Read `scenes/Ask.tsx` first; it uses all of them.
- Time comes from `useClock()` only. No CSS transition or animation class, no timer, no `Math.random()`: a frame has
  to draw the same on its own, in any order.
- Reuse a screen in `site/src/components/mock/`. When a scene needs the screen in a state over time, give the mock a
  prop whose default is what the page shows (as `ClipperPopup`'s `note`, `PhoneTasks`' `tasks`, `AskDock`'s `turn` and
  `draft`), and put `data-tap="<name>"` on a control a `Tap` presses.
- When no mock draws the feature, draw one in `mock/` under `site/README.md`'s rules: a copy in structure of the real
  `web/src/components/`, fictional content, the page's tokens, lucide's icons. The film may use it at once; whether the
  page shows it too stays `promo-refresh`'s proposal.
- Never a screenshot or a recording, never a colour, font or icon of the film's own, never sound, never a screen doing
  something the app does not do.

## 5. Verify

```sh
cd video && bun install && bun run lint && bun run typecheck && bun test
cd site && bun install && bun run build      # only if a mock or the site's CSS changed
```

`bun test` holds the storyboard to `RULES`. Then render stills and **look at every one** (read the JPEGs in
`video/out/stills/`). On the minipc a render runs capped, one at a time:

```sh
cd video && systemd-run --user --unit=film-render --collect --wait --pipe -q -p CPUQuota=300% -p CPUWeight=20 \
  -p MemoryHigh=2G -p WorkingDirectory="$PWD" -E PATH="$PATH" -E HOME="$HOME" ~/.bun/bin/bun scripts/render.ts stills
```

`stills` gives three moments of every scene; `stills <Scene>` gives every half second of one, which is what a scene
you touched needs. In them, check that:

- the caption sits on its lines without a stray word, and nothing is cut off that should be whole
- the device is large enough to read, and its text is in Atkinson, not a fallback face
- each `Tap` lands on its control, at the moment the screen answers it
- typed text is finished before it is sent, and the scene's last still is not empty

When a scene's motion changed, also render the film (`scripts/render.ts film --concurrency=2` in the same unit, about
two minutes) and embed `video/out/film.mp4` in the report, so Spyros can watch it.

## 6. Commit and ship

One commit whose subject starts with `Video:` (the marker step 1 reads), for example
`Video: voice input takes the lens scene's slot`. Merge it to main and push; stop instead if the live checkout is
dirty. The push runs `pages.yml`, which renders the film (`film.yml`) and publishes it as the site's hero;
the next tag attaches it to the release. Check the run: `gh run list --workflow=pages.yml --limit 1`.

## Report

Lead with the verdict: re-cut, or no change. Then what came in, what left and which words changed, each with its
reason; the candidates that did not make it, a line each; and the one next step.
