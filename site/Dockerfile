# Build context is the REPOSITORY ROOT (the site imports the core (../packages/core) and the fonts and icon from ../assets):
#   docker build -f site/Dockerfile -t tefnotes-site .
FROM oven/bun:1 AS build
WORKDIR /app
COPY site/package.json site/bun.lock site/
RUN cd site && bun install --frozen-lockfile
COPY packages/core/src packages/core/src
COPY packages/core/vite.ts packages/core/vite.ts
COPY assets/fonts assets/fonts
COPY assets/icon.png assets/icon.png
COPY site site
RUN cd site && bun run build

FROM caddy:alpine
COPY site/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/site/dist /srv
EXPOSE 80
