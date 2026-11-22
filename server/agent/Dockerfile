# The agent sidecar (src/index.ts). Context: the repo root (docker-compose.yml), for the shared core it imports as
# @/core (packages/core, mapped by tsconfig.json's paths, which bun honours at runtime); allowlist:
# Dockerfile.dockerignore beside this file.
# Debian, not Alpine: the embedding model's runtime (onnxruntime-node, src/semantic.ts) ships glibc binaries only.
FROM oven/bun:1.3.9-slim
WORKDIR /app/server/agent
# Fonts for a PDF's first page and a drawing's text (the render process, src/render-child.ts): a PDF that names Helvetica, Arial, Times or Courier without
# embedding it is drawn in Liberation's look-alikes (Greek too); without any font installed its text draws blank.
# Tesseract reads scanned PDF pages (src/ocr.ts). Its language data is not the image's: the languages in TEF_NOTES_OCR are
# downloaded into /data on first use, so any of them works without another image.
RUN apt-get update && apt-get install -y --no-install-recommends fontconfig fonts-liberation tesseract-ocr && rm -rf /var/lib/apt/lists/*
# The search index and the embedding model (src/semantic.ts), what OCR read and its language data (src/ocr.ts): derived, a
# volume so a restart neither re-downloads, re-embeds nor re-reads.
RUN mkdir /data && chown bun:bun /data
COPY server/agent/package.json server/agent/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY packages/core/src /app/packages/core/src
COPY server/agent/tsconfig.json ./
COPY server/agent/src ./src
USER bun
# The release this image is, shown in Settings and compared with GitHub's newest (src/release.ts); docker.yml passes the tag.
ARG TEF_NOTES_VERSION
ENV TEF_NOTES_IMAGE_VERSION=${TEF_NOTES_VERSION}
ENV HOST=0.0.0.0 PORT=8098 TEF_NOTES_DATA=/data
EXPOSE 8098
CMD ["bun", "src/index.ts"]
