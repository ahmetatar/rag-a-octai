# Debian-based rather than alpine: node-llama-cpp ships prebuilt glibc binaries, while on
# alpine (musl) its postinstall falls back to compiling llama.cpp from source, which needs
# git and a full toolchain in the image.

# ---- Build stage: needs devDependencies (typescript, tsc-alias) ----
FROM node:22-slim AS builder

WORKDIR /app

# Dependencies are copied on their own so this layer stays cached while sources change.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Drop devDependencies here rather than reinstalling in the runtime stage: the tree is
# copied as-is, which preserves the native binaries prepared during install.
RUN npm prune --omit=dev

# ---- Runtime stage: no toolchain, no devDependencies, no sources ----
FROM node:22-slim

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# The upload staging dir must be writable by the non-root user; create it owned by node
# so the app (and any mounted volume) can write there.
RUN mkdir -p /app/uploads && chown node:node /app/uploads

# GGUF models are deliberately not baked into the image (see .dockerignore). Mount them
# when using EMBEDDING_PROVIDER=llama:  -v ./models:/app/models
USER node

EXPOSE 3000

# Uses the app's own liveness endpoint. Node 22 has global fetch, so the image needs no
# curl or wget for this.
# NOTE: podman builds OCI images by default and silently ignores HEALTHCHECK. Build with
# `podman build --format docker .` to keep it, or rely on the compose-level healthcheck.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `node` directly instead of `npm start`: npm would sit between the init process and the
# server, and the graceful shutdown handler needs to receive SIGTERM itself.
CMD ["node", "dist/src/index.js"]
