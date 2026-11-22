# The updater (src/updater/): the opt-in service that updates the install from the app (docker-compose.yml, profile
# `updater`). Bun for its code, Docker's CLI and Compose plugin to drive the host's daemon through the mounted socket, tar for
# the pb_data snapshot. Context: the repo root; allowlist: updater.Dockerfile.dockerignore beside this file.
# Runs as root: the Docker socket is root's. That is why it is opt-in and takes nothing but a version (src/updater/update.ts).
FROM oven/bun:1.3.9-alpine
RUN apk add --no-cache docker-cli docker-cli-compose tar
WORKDIR /app/server/agent
COPY packages/core/src /app/packages/core/src
COPY server/agent/tsconfig.json ./
COPY server/agent/src/updater ./src/updater
ENV PORT=8099
EXPOSE 8099
ENTRYPOINT ["bun", "src/updater/main.ts"]
