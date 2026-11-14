---
name: release
description: Cut a TEF Notes release end to end - changelog section, commit, tag, push, live redeploy, then the promo refresh and the promo film's re-cut so the README, the site and the film cover it. Use when Spyros says release, cut a release, tag a version, ship vX.Y.Z, or /release.
---

# Release

The versioning rule (one semver for the repo, the tag is its only source) is `CONTRIBUTING.md` → Versioning. This skill
is the routine around it. Work in the live checkout, `~/projects/tefteri`, on `main`.

## 1. Preflight, or stop

```sh
cd ~/projects/tefteri && git status --porcelain && git pull --ff-only
```

Tracked changes (above all new `server/pb_migrations/`) mean stop and say so: the deploy in step 4 would ship them
unreviewed. Untracked build output (`web/dist-*`, `mobile/`) is fine.

## 2. Version and changelog

```sh
git log --oneline $(git describe --tags --abbrev=0)..main
```

Nothing user-facing since the last tag: stop, no release. Otherwise pick the bump: **minor** for anything added,
**patch** for fixes only (pre-1.0, so no major). Move `## Unreleased` entries, plus anything those commits shipped
that it lacks, under `## X.Y.Z - YYYY-MM-DD` in `CHANGELOG.md`, grouped Added / Changed / Fixed / Removed, written for
a user, one line per change, no commit hashes. Leave `## Unreleased` empty above it.

## 3. Commit, tag, push

```sh
git commit -am "Release X.Y.Z" && git tag vX.Y.Z && git push origin main vX.Y.Z
```

Never move or re-push an existing tag. The tag starts `release.yml` (GitHub release: the extension zip, the companion's
APK, the promo film) and `docker.yml` (GHCR images).

## 4. Redeploy the live server

```sh
cd server && TEF_NOTES_VERSION=$(sh ../scripts/version.sh) docker compose up -d --build
```

Without the variable Settings → Maintenance shows 0.0.0. Confirm `scripts/version.sh` printed the new version.

## 5. Promo refresh, then the film

Run the `promo-refresh` skill now, so the README and site cover this release the same day (the weekly scheduled run is
only a backstop). It decides itself whether there is drift and commits as `Promo: …`.

Then run the `promo-video` skill: it decides whether the release changes the promo film's cut and commits as
`Video: …`. In this order, because the refresh may change a drawn screen or the headline the film shows. The release
already carries the film as it was at the tag; a re-cut reaches the site with its own push and the next release.

## 6. Check the runs

`gh run list --limit 5`: Release, Docker images, CI and (if promo touched `site/` or `video/`) Pages, which renders
the film first. Report any failure with its first error line.

## Report

The version, the changelog lines, the deploy, what promo changed, what the film's cut did, the state of the runs.
