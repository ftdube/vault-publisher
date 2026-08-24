# Next Steps

## Phase 1 — MVP (current)

| Item | Status | Notes |
|---|---|---|
| Daemon: git poll + conditional build + two-step rename | Implemented, untested end-to-end | TypeScript, `src/` compiled to `dist/`; see Verify item below |
| Dockerfile: node:22-slim, git, `@jackyzha0/quartz` git dep, pre-baked plugins | Implemented, untested end-to-end | Not yet built or run — see Verify item below |
| Default `quartz.config.yaml` with env var placeholders | Implemented | Baked into image (decided — see below) |
| CI: `ci.yml` (lint/test/scan/build/push) to GHCR | Planned | Mirror `secondbrain-mcp`'s combined workflow — it has one `ci.yml`, not a separate `build-image.yml` |
| K8s deployment docs: two-container Pod, hostPath, nodeSelector | Planned | |
| Gatus health check for the served site | Planned | Ocean pattern: every new service gets a Gatus check |

## Verify — build and run the actual image

The daemon and Dockerfile were written and the underlying quartz invocation was verified manually (real `npm install` of the git dependency, real `quartz build` against an external content dir, real plugin pre-bake, real `envsubst` run) — but Docker wasn't running in the environment that wrote this code, so the image itself has never been built or run, and the daemon's poll loop has never executed end-to-end. `/vault`, `/site`, `/site-next` are hardcoded absolute paths, so this can only be tested in a container, not on a bare host.

**Trigger:** before first real deployment — `docker build`, then `docker run` against a real (even tiny) vault repo and confirm a site actually gets published to `/site`.

## quartz.config.yaml delivery — decided

Baked into the image with `envsubst` placeholders (not a K8s ConfigMap): simpler, works out of the box. FR-CFG-3 still allows an operator to mount a custom `quartz.config.yaml` over the baked-in default for full control.

## Phase 2 — Observability

- Prometheus metrics on `:9090/metrics`: build duration, last build timestamp, build success/failure counter (NFR-OBS-1)
- `prometheus.io/scrape`, `prometheus.io/port`, `prometheus.io/path` Pod annotations so VictoriaMetrics's existing `kubernetes-pods` scrape job picks it up automatically — same pattern as `dex` in Ocean (NFR-OBS-2). The pod's `app` label becomes the metric `job` label after scraping; it does not control whether scraping happens.
- Grafana dashboard (follow Ocean pattern: ConfigMap with `grafana_dashboard: "1"`)

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
