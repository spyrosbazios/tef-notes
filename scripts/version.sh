#!/bin/sh
# The repo's one version: TEF_NOTES_VERSION if set, else the latest git tag (vX.Y.Z -> X.Y.Z), else 0.0.0.
# Every build reads it from here (extension manifest, Android app, release workflow); nothing stores it in a package.json.
if [ -n "${TEF_NOTES_VERSION:-}" ]; then
  printf '%s\n' "$TEF_NOTES_VERSION"
elif tag=$(git -C "$(dirname "$0")" describe --tags --abbrev=0 2>/dev/null); then
  printf '%s\n' "${tag#v}"
else
  printf '0.0.0\n'
fi
