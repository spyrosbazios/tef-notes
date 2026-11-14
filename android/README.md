# TEF Notes Companion (Android)

<!-- reviewed: 2026-11-14 -->

A small native app that gives [TEF Notes](../README.md) the entry points an installed web app can't have on Android.
It is not a second client: the app you use is still the web app, installed from Chrome. The companion has no notes
screen and no task screen; everything it shows comes from your server ready to draw, and a tap opens the web app there.

## What it adds

- **Tasks widget**: Today, the Inbox or Upcoming on the home screen. Tick a task, tap one to open it, add one with the
  plus. Hold the widget and choose its settings to pick the list.
- **Notes widget**: your pinned notes, then the latest, each in its own colour.
- **Save to TEF Notes** in the share sheet (a link, text or one picture) and in the menu over selected text in any
  app. The server suggests the notes and open tasks it fits, as for the [Chrome clipper](../extension/README.md); you
  pick one, or a new note or task. Its tags come the same way: the server's picks are on (a tap takes one off), the
  likely ones are offered, and any other tag you have defined is in a list.
- **New task**: a quick-settings tile and a shortcut on the launcher icon.
- **Offline**: a share or a new task made with the server out of reach waits on the phone and is sent when it is back;
  a tick on a widget does the same. Settings lists what waits.

Widgets follow your theme, accent and the lens you have on, and show what the web app shows under that lens. A widget's
heading switches the lens, for the web app too, and its sparkle opens the assistant ready for a message: a task to
schedule, something to note.

## Requirements

- Android 14 or later, with a browser. Opening a note or a task goes to your installed TEF Notes when Chrome is the
  default browser; otherwise it opens in that browser.
- A running TEF Notes server ([`../server/README.md`](../server/README.md)) at an https address the phone can reach.
  There is no sign-in, as for every client: the private network is the gate, so the phone must be on it.

## Install

Download `tef-notes-companion-<version>.apk` from the [releases](https://github.com/spyrosbazios/tef-notes/releases) and
open it on the phone. Then open **TEF Notes Companion**, type your server's address and press **Connect**. The same
screen adds the widgets and the tile.

Updates install over the app only when they are signed with the same key, so stay with one source: the releases, or
your own builds.

## Build

You need a JDK 17, the Android SDK (platform 37, build-tools 36) and [bun](https://bun.sh), with the whole repository
cloned: the build reads the palette and the brand mark from `../packages/core` and the fonts from `../assets`.

```sh
cd android
bun install                      # lucide, for the icons
export JAVA_HOME=...             # a JDK 17
export ANDROID_HOME=...          # the Android SDK
./gradle.sh testDebugUnitTest    # the unit tests
./gradle.sh lintRelease          # Android lint, warnings are errors
./gradle.sh assembleRelease      # app/build/outputs/apk/release/app-release.apk
```

`gradle.sh` fetches the pinned Gradle on first use and checks it against Gradle's published checksum; the repository
keeps no wrapper jar.

The release build is signed with your keystore when these are set, and with the debug key otherwise:

| Variable | What it is |
|---|---|
| `TEF_NOTES_KEYSTORE` | Path to the keystore file |
| `TEF_NOTES_KEYSTORE_PASSWORD` | Its password |
| `TEF_NOTES_KEY_ALIAS` | The key's alias in it |
| `TEF_NOTES_KEY_PASSWORD` | The key's password |

The version is the repository's (`../scripts/version.sh`).

## How it talks to the server

The feeds and the two task writes are the server's companion routes, `/agent/companion/*`; a share goes through the
clip routes the extension uses. The contract, with every route, is the header of
[`../packages/core/src/companion.ts`](../packages/core/src/companion.ts).
