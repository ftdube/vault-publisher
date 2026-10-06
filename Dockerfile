# Trims package.json to only the fields npm ci / dependency resolution care
# about, so edits to description/scripts/etc. don't bust the npm ci and
# plugin pre-bake layers below — pre-bake alone costs ~3.5min when it reruns.
FROM node:26-slim AS deps-manifest
WORKDIR /usr/src/app
COPY package.json ./
RUN node -e " \
  const fs = require('fs'); \
  const p = JSON.parse(fs.readFileSync('package.json', 'utf8')); \
  const { name, version, private: priv, type, engines, dependencies, devDependencies, overrides } = p; \
  fs.writeFileSync('package.json', JSON.stringify({ name, version, private: priv, type, engines, dependencies, devDependencies, overrides }, null, 2)); \
  "

FROM node:26-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /usr/src/app
COPY --from=deps-manifest /usr/src/app/package.json ./
COPY package-lock.json ./
RUN npm ci
COPY quartz.config.yaml ./
RUN cp quartz.config.yaml node_modules/@jackyzha0/quartz/quartz.config.yaml

# Pre-bake community plugins (.quartz/plugins) with a throwaway build so the
# pod never has to fetch or build them at startup (NFR-BUILD-3). Quartz prunes
# each plugin's devDependencies itself but skips that when the tsup DTS step
# fails (see agent-archive.md), leaving vite/vitest CVEs in the image (issue #9).
# Prune only those (tsup still present): pruning the rest would delete peer
# symlinks Quartz created after its own prune (e.g. latex -> rehype-typst).
RUN mkdir -p /tmp/seed-content \
    && echo "# seed" > /tmp/seed-content/index.md \
    && cd node_modules/@jackyzha0/quartz \
    && node ./quartz/bootstrap-cli.mjs build -d /tmp/seed-content --output /tmp/seed-output \
    && rm -rf /tmp/seed-content /tmp/seed-output \
    && for p in .quartz/plugins/*/; do \
         if [ -d "${p}node_modules/tsup" ]; then (cd "$p" && npm prune --omit=dev) || exit 1; fi; \
       done

# Real package.json (scripts, description, ...) only needed from here on.
COPY package.json ./
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build && npm prune --omit=dev

FROM node:26-slim
# Nothing runs npm at runtime (plugins are pre-baked); the base image's bundled
# copy only adds CVEs to the trivy scan (issue #9).
RUN apt-get update && apt-get install -y --no-install-recommends gettext-base \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /usr/src/app
COPY --from=builder --chown=node:node /usr/src/app/node_modules ./node_modules
COPY --chown=node:node package.json quartz.config.yaml ./
COPY --from=builder --chown=node:node /usr/src/app/dist ./dist
# The node:*-slim images ship a non-root `node` user (uid/gid 1000) — issue #8: the daemon
# has SSH-adjacent hostPath access and runs third-party quartz plugins at build
# time, so it must not run as root.
USER node
ENTRYPOINT ["node", "dist/daemon.js"]
