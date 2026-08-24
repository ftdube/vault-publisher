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

## Blocked — Incremental builds (FR-BUILD-6)

A one-shot `npx quartz build` (no `--watch`) always does a full rebuild — `ctx.incremental` only becomes `true` inside `startWatching()`, and that requires a persistent watch-mode process. That conflicts with the decision to keep quartz ephemeral per build (see BRD Appendix B — `--serve` was rejected for keeping quartz resident in memory).

Two paths, neither available today:
- Upstream ships incremental support for one-shot builds — tracked on `jackyzha0/incremental-rebuild-v2` (unmerged, not yet on `v5`)
- Redesign the daemon around a long-running `--watch` process, reopening the RAM-resident tradeoff

**Trigger:** `incremental-rebuild-v2` merges to `v5`, or Phase 3 build times force the `--watch` tradeoff back onto the table.

## Deferred — DataviewJS pre-rendering

Build a custom Quartz transformer plugin that pre-renders `dataviewjs` code blocks at build time using a Node.js `vm` shim backed by the vault's frontmatter index. Scoped to frontmatter-driven queries only.

Full concept documented in SecondBrain vault `Inbox/dataviewjs-static-prerender.md`.

**Trigger:** personal need for DataviewJS in the published site.

## Deferred — Obsidian Bases support

Upstream `feat/bases` branch adds a static-build-time alternative to DataviewJS. Monitor for merge to `v5`.

**Trigger:** `feat/bases` merged to quartz `v5`.
