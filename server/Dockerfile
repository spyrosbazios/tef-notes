# Built from the repo root: the web app imports the shared core and palette (packages/core) and the phone's fonts and
# icon, and PocketBase serves it from pb_public, on the same origin as the API. Context allowlist: Dockerfile.dockerignore.
#
# Two targets. `server` (the last stage, so the default) is the published image, ghcr.io/spyrosbazios/tef-notes: the server,
# hooks, migrations and the web app. It holds no per-deployment value: the web app calls its own origin, and the extension
# is not in it. `with-extension` adds the signed Chrome extension, which needs the deployment's public origin and the
# owner's signing key, so it is built locally only (docker-compose.build.yml).
#
# The web build's output is static files, the same on every architecture: it runs on the builder's own, never emulated.
FROM --platform=$BUILDPLATFORM oven/bun:1.3.9-alpine AS web
WORKDIR /src/web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY packages/core/src /src/packages/core/src
COPY packages/core/vite.ts /src/packages/core/vite.ts
COPY mobile/assets/fonts /src/mobile/assets/fonts
COPY mobile/assets/images/icon.png /src/mobile/assets/images/icon.png
COPY web ./
RUN bun run build

# The Chrome extension, signed and served for self-hosted install and update (extension/scripts/crx.ts). Reached by the
# `with-extension` target only. TEF_NOTES_URL, the public origin, is the extension's update_url and its update.xml's
# codebase. The key is a BuildKit secret: it never reaches a layer. Without it (an empty placeholder) the build goes on and
# serves no extension. A secret's content is not part of the cache key; CRX_KEY_FILE, its host path, is, so naming the key
# reruns the pack. Likewise TEF_NOTES_VERSION, the extension's version.
FROM web AS extension
WORKDIR /src/extension
COPY extension/package.json extension/bun.lock ./
RUN bun install --frozen-lockfile
COPY extension ./
# The manifest's version comes from scripts/version.sh, which reads TEF_NOTES_VERSION (no .git in the image): Chrome
# installs an update only when this is higher than the installed one, so a build names it.
COPY scripts/version.sh /src/scripts/version.sh
ARG TEF_NOTES_URL CRX_KEY_FILE TEF_NOTES_VERSION
RUN --mount=type=secret,id=crx_key \
    bun run build && bun run pack /run/secrets/crx_key /src/extension/out

FROM alpine:3.22 AS base
ARG PB_VERSION=0.40.6
# BuildKit sets it (amd64, arm64): PocketBase publishes a zip for each
ARG TARGETARCH
# curl: pb_hooks/link-preview.pb.js fetches pages with it (redirects and size under its own control, see lib/link-preview.js)
RUN apk add --no-cache ca-certificates curl unzip wget \
 && wget -q https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip -O /tmp/pb.zip \
 && unzip /tmp/pb.zip -d /pb && rm /tmp/pb.zip
WORKDIR /pb
COPY --from=web /src/web/dist /pb/pb_public
# Baked in, never bind-mounted: PocketBase restarts on a hook change and applies every pending migration, so a mounted
# checkout deployed whatever was saved. They change with `up --build` only.
COPY server/pb_migrations /pb/pb_migrations
COPY server/pb_hooks /pb/pb_hooks
EXPOSE 8090
CMD ["./pocketbase", "serve", "--http=0.0.0.0:8090", "--migrationsDir=/pb/pb_migrations", "--hooksDir=/pb/pb_hooks", "--publicDir=/pb/pb_public"]

FROM base AS with-extension
COPY --from=extension /src/extension/out /pb/pb_public/extension

FROM base AS server
