#!/bin/sh
# Gradle, pinned: the repository keeps no wrapper jar (no binaries in git), so this fetches the one version the build is
# tested with, checks it against Gradle's published SHA-256, unpacks it once under GRADLE_USER_HOME and runs it.
#   ./gradle.sh assembleRelease        (JAVA_HOME: a JDK 17; ANDROID_HOME: the SDK; bun on PATH)
set -eu
VERSION=9.8.2
SHA256=21bd5da2de49b642904077f38c0efdc7778e92b3ed0889392dca61b97e389607

home="${GRADLE_USER_HOME:-$HOME/.gradle}/tefnotes"
gradle="$home/gradle-$VERSION/bin/gradle"
if [ ! -x "$gradle" ]; then
  mkdir -p "$home"
  zip="$home/gradle-$VERSION-bin.zip"
  curl -fsSL -o "$zip" "https://services.gradle.org/distributions/gradle-$VERSION-bin.zip"
  echo "$SHA256  $zip" | sha256sum -c - >/dev/null || { echo "gradle.sh: gradle-$VERSION-bin.zip does not match its checksum" >&2; rm -f "$zip"; exit 1; }
  unzip -q -o "$zip" -d "$home"
  rm -f "$zip"
fi
cd "$(dirname "$0")"
exec "$gradle" "$@"
