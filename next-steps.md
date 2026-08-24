# Next Steps

## Phase 1 — MVP (current)

| Item | Status | Notes |
|---|---|---|
| Daemon: git poll + conditional build + atomic rename | Planned | Core loop |
| Dockerfile: node:22-slim, git, quartz npm dep, pre-installed node_modules | Planned | |
| Default `quartz.config.yaml` with env var placeholders | Planned | Open: baked-in vs ConfigMap (see below) |
| CI: `ci.yml` (lint/test/scan/build/push) to GHCR | Planned | Mirror `secondbrain-mcp`'s combined workflow — it has one `ci.yml`, not a separate `build-image.yml` |
| K8s deployment docs: two-container Pod, hostPath, nodeSelector | Planned | |
| Gatus health check for the served site | Planned | Ocean pattern: every new service gets a Gatus check |

## Open: quartz.config.yaml delivery

Two options, not yet decided:

| Option | Pro | Con |
|---|---|---|
| Baked into image with `envsubst` placeholders | Simple; works out of the box | Quartz config schema changes require image rebuild |
| Mounted via K8s ConfigMap | Fully operator-controlled; no image rebuild for config changes | More complex deploy; operators must maintain their own config |

**Trigger to decide:** when writing the Dockerfile and entrypoint. Start with baked-in; document ConfigMap override path for advanced users.

## Phase 2 — Observability

- Prometheus metrics: build duration, last build timestamp, build success/failure counter
- Grafana dashboard (follow Ocean pattern: ConfigMap with `grafana_dashboard: "1"`)
- VictoriaMetrics scraping via pod `app` label relabeling

**Trigger:** after Phase 1 is deployed and stable.

## Phase 3 — Build performance

- Measure actual build time and peak RAM on RPi5 for a representative vault size
- If build time > 2 min or peak RAM > 400 MB: investigate quartz incremental build options or content filtering

**Trigger:** real-world metrics from Phase 2.

## Deferred — DataviewJS pre-rendering

Build a custom Quartz transformer plugin that pre-renders `dataviewjs` code blocks at build time using a Node.js `vm` shim backed by the vault's frontmatter index. Scoped to frontmatter-driven queries only.

Full concept documented in SecondBrain vault `Inbox/dataviewjs-static-prerender.md`.

**Trigger:** personal need for DataviewJS in the published site.

## Deferred — Obsidian Bases support

Upstream `feat/bases` branch adds a static-build-time alternative to DataviewJS. Monitor for merge to `v5`.

**Trigger:** `feat/bases` merged to quartz `v5`.
