# The agent sidecar (src/index.ts). Context: the repo root (docker-compose.yml), for the shared core it imports as
# @/core (packages/core, mapped by tsconfig.json's paths, which bun honours at runtime); allowlist:
# Dockerfile.dockerignore beside this file.
# Debian, not Alpine: the embedding model's runtime (onnxruntime-node, src/semantic.ts) ships glibc binaries only.
FROM oven/bun:1.3.9-slim
WORKDIR /app/server/agent
# Fonts for a PDF's first page (src/pdfs.ts `thumb`): a PDF that names Helvetica, Arial, Times or Courier without
# embedding it is drawn in Liberation's look-alikes (Greek too); without any font installed its text draws blank.
RUN apt-get update && apt-get install -y --no-install-recommends fontconfig fonts-liberation && rm -rf /var/lib/apt/lists/*
# The search index and the embedding model (src/semantic.ts): derived, a volume so a restart neither re-downloads nor re-embeds.
RUN mkdir /data && chown bun:bun /data
COPY server/agent/package.json server/agent/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY packages/core/src /app/packages/core/src
COPY server/agent/tsconfig.json ./
COPY server/agent/src ./src
USER bun
ENV HOST=0.0.0.0 PORT=8098 TEF_NOTES_DATA=/data
EXPOSE 8098
CMD ["bun", "src/index.ts"]
