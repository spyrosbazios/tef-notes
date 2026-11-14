# android: the companion app

Kotlin, Jetpack Compose for its three small screens, Glance for the widgets, WorkManager for the one background job. What
it is and how to build it: `README.md`. Root `AGENTS.md` has the server; this file only what is the companion's.

<!-- reviewed: 2026-11-14 -->

## Where facts live

| Path | Holds | Authority |
|---|---|---|
| `../packages/core/src/companion.ts` | The contract: the routes, the feeds' shapes, the look, what a companion may copy | ⭐ |
| `../server/agent/src/companion.ts` | The routes | |
| `../packages/core/test/companion-cases.json` | The cases the copied rules are checked against, run by the core's tests and by `CasesTest.kt` | ⭐ |
| `app/src/main/kotlin/.../Contract.kt` | The server's answers as read here, and the copied rules. Pure Kotlin, JVM-tested | |
| `Server.kt` | The server's address and last look (`Store`), the requests (`Api`), `Unreachable` and `Refused` | |
| `Sync.kt`, `Outbox.kt` | The one background job; what waits to be sent | |
| `ClipActivity.kt`, `TaskActivity.kt`, `SettingsActivity.kt`, `OpenActivity.kt`, `TaskTile.kt` | The share sheet, the new task, the settings, the way into the web app, the tile | |
| `widget/` | The two widgets, their per-widget state (`Keys`), frame and actions; the Tasks widget's list picker; the lens picker (`LensActivity`) | |
| `scripts/generate.ts` | Colours, icons (lucide), the brand mark and fonts as resources, written at build time into `app/build` | |
| `gradle.sh` | The pinned Gradle version and its checksum | |

## Invariants

- **No rules here.** What a widget lists, in which order, under which label, where a row opens and in which colours is
  the server's answer. A new need is a new field in `companion.ts`, for the iPhone companion too, never logic in Kotlin.
  The copies that exist (a share as a clip, a picture's sizes, a clip's choices, tags and result lines) are listed in
  `companion.ts`'s header and each has cases in `companion-cases.json`; a new copy needs both.
- **No screens of the app's.** A tap opens the web app (`OpenActivity`) at a `url` the server sent; the assistant button is one such (`Switches.ask`), not a chat of its own.
- **No colour, icon or font of its own.** Colours are the feed's `look`, or the generated default (`R.color.tf_*`);
  icons are lucide through `scripts/generate.ts` (`ICONS`); nothing generated is committed or edited.
- **Only https, and no sign-in**: the same gate as every client (`../SECURITY.md`). Never allow cleartext.
- **Nothing the owner saved is dropped.** Out of reach, it waits (`Outbox`, the pending ticks in `Store`); refused for
  good, it stays in Settings until discarded.
- A change to a route's answer raises `COMPANION_CONTRACT` and `CONTRACT` together; Settings then names which side to
  update.

## Footguns

- The unit tests cover `Contract.kt` only. The widgets, the sheets and the sync are checked by hand on a phone: there
  is no emulator on the build host and no instrumented test.
- Android's `JSONObject.optString` answers the text "null" for a JSON null; the JVM test library answers "". Only
  `Hello.tag` is ever null, and `helloOf` asks `isNull` first. A new nullable field needs the same.
- `compileSdk` is 37 because Compose 1.12 requires it. `targetSdk` stays at 36: targeting 37 makes reaching a server on
  the local network need a run-time permission (`ACCESS_LOCAL_NETWORK`), which must be built and tried on a phone first.
- Lint fails the build on any warning, except the four that fire when the world moves, not the code
  (`app/build.gradle.kts` says which and why). Fix a finding; don't add to that list.
- WorkManager turns one of its own components on and off as work comes and goes, and that makes Android send every
  widget an update. `onUpdate` enqueues a sync, so the half-hourly job is scheduled first (`Sync.keepFresh`): while it
  is pending the component stays on and there is no loop.
- A widget's composition only re-runs when its Glance state changes. Whatever a widget draws must be in that state
  (`Keys`), written with `updateAppWidgetState`; a value read from `Store` alone never redraws it.
- A sync never runs beside another (the worker's mutex): a clip's save is not idempotent, and two at once would send
  it twice. A save whose answer was lost, or cut off by the process dying, is still sent again. Retrying is its own
  piece of work (`Sync.again`): a `Result.retry()` on the `sync` chain would hold every later run behind its backoff.
- Unit tests read JSON with `org.json:json` from Maven; on the device it is the platform's. Code that compiles against
  one may miss in the other (`keySet()` is not in the platform's).
- Gradle builds on a small host: run them one at a time, CPU-capped, and stop the daemon after (`./gradle.sh --stop`).
