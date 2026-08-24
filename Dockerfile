FROM node:22-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci
COPY quartz.config.yaml ./
RUN cp quartz.config.yaml node_modules/@jackyzha0/quartz/quartz.config.yaml

# Pre-bake community plugins (.quartz/plugins) with a throwaway build so the
# pod never has to fetch or build them at startup (NFR-BUILD-3).
RUN mkdir -p /tmp/seed-content \
    && echo "# seed" > /tmp/seed-content/index.md \
    && cd node_modules/@jackyzha0/quartz \
    && node ./quartz/bootstrap-cli.mjs build -d /tmp/seed-content --output /tmp/seed-output \
    && rm -rf /tmp/seed-content /tmp/seed-output

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
# git/openssh-client dropped: vault sync is owned by a git-sync sidecar (BRD §9.2), not this
# container. gettext-base stays for envsubst (FR-BUILD-4).
RUN apt-get update && apt-get install -y --no-install-recommends gettext-base \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY package.json quartz.config.yaml ./
COPY --from=builder /usr/src/app/dist ./dist
ENTRYPOINT ["node", "dist/daemon.js"]
