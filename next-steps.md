# Next Steps

## Phase 1 — MVP (current)

| Item | Status | Notes |
|---|---|---|
| Daemon: `/vault/current` change detection (git-sync-owned symlink) + conditional build + two-step rename | Implemented, untested end-to-end | TypeScript, `src/` compiled to `dist/`; see Verify item below. No git/SSH code in the daemon anymore — see Phase 1.5 |
| Dockerfile: node:22-slim, `@jackyzha0/quartz` git dep, pre-baked plugins | Builds successfully in CI (image build); daemon untested end-to-end | See Verify item below. `git`/`openssh-client` dropped from the final stage (git-sync sidecar owns git now) |
| Default `quartz.config.yaml` with env var placeholders | Implemented | Baked into image (decided — see below) |
| CI: `ci.yml` (typecheck/test/scan/build/push) to GHCR | Implemented | "lint" renamed to "typecheck" — there's no ESLint config, just `tsc --noEmit` |
| Unit tests: `src/*.test.ts` via `node:test` (through `tsx`, not compiled) | Implemented | Covers `env.ts`/`log.ts`/`build.ts`'s `substituteConfig`/`vault.ts`'s `readVaultCurrentRef` (real symlinks in a tmpdir). Rename/build-info promotion in `build.ts` needs a real mounted `/site` (a mount point behaves differently than a tmpdir — see Verify item below) — covered by the Docker-based Verify pass, not by a unit test |
| K8s deployment docs: three-container Pod (git-sync, builder, Caddy), hostPath, nodeSelector | Planned | Container count depends on Phase 1.5 (git-sync sidecar) landing first |
| Health check for the served site | Planned | Every new service gets a Gatus (or equivalent) check once deployed |

## Verify — build and run the actual image — Done (2026-08-25)

Executed against the real image and the real `registry.k8s.io/git-sync/git-sync:v4.2.4` sidecar, using a throwaway sample vault (bare local repo, no personal content). Found a launch-blocking bug: `/site` is the hostPath mount point itself, and `rename(2)` cannot rename a mount point (`EBUSY`), so every promotion was failing and the site never published — see issue #4, RISK-6, BRD v0.5. Fixed in `src/build.ts` (`current`/`next`/`old` as subdirectories of `/site`, not the mount point) and re-verified: build succeeds, a second vault commit triggers a rebuild within `POLL_INTERVAL`, and output is correctly published to `/site/current`.

Also confirmed while at it:
- `/vault/current` tracks the configured branch specifically, not some other ref
- git-sync's worktree dirs are named deterministically by commit SHA (RISK-10, closed) — no spurious-rebuild risk

Not covered by this pass: SSH-key auth (tested via local `file://`, not SSH), and content-specific quartz behavior beyond a few notes (Dataview queries, deep folder structures, the community plugins' actual runtime behavior against real frontmatter).

## quartz.config.yaml delivery — decided

Baked into the image with `envsubst` placeholders (not a K8s ConfigMap): simpler, works out of the box. FR-CFG-3 still allows an operator to mount a custom `quartz.config.yaml` over the baked-in default for full control.

## Phase 1.5 — git-sync sidecar

Delegates vault cloning/pulling from the daemon to a `git-sync` sidecar (BRD §8, §9.2, v0.3). The daemon's side is implemented: it reads `/vault/current`, builds, atomically promotes — no git code, no SSH key, no `VAULT_REPO_URL`/`VAULT_BRANCH` in the daemon at all (`git.ts` deleted, `src/vault.ts` added). `Dockerfile`'s final stage no longer installs `git`/`openssh-client`.

Remaining, not yet done (needs a real git-sync sidecar to verify against, and this repo doesn't own K8s manifests yet):

| Item | Notes |
|---|---|
| Add `registry.k8s.io/git-sync/git-sync` to K8s deployment docs, pinned tag, with rev-retention configured longer than the slowest expected build | Folds into Phase 1's still-Planned "K8s deployment docs" item; pinning addresses RISK-8, retention addresses RISK-9 |
| Verify end-to-end against a real git-sync sidecar | See "Verify — build and run the actual image" above; unit tests only cover `readVaultCurrentRef` against a synthetic symlink, not a real git-sync process |

### Configurable trigger mode: webhook vs poll

Default is self-poll (FR-BUILD-7): the daemon reads `/vault/current` on `POLL_INTERVAL`. Add a K8s-configurable option — e.g. `SYNC_TRIGGER_MODE=poll|webhook` on the daemon, default `poll` — to instead have git-sync push a webhook call to the daemon after each successful sync (its `--webhook-url` flag) for near-instant builds instead of `POLL_INTERVAL`-bounded latency (FR-BUILD-8). Needs: a small HTTP listener in the daemon, a shared secret/token for the inbound call (git-sync's `--webhook-url` has no built-in auth of its own), and a decision on what port it listens on (separate from `:9090/metrics`).

**Trigger:** an operator wants sub-`POLL_INTERVAL` build latency, or the git-sync sidecar phase above is stable and this becomes worth the added listener surface.

## Phase 2 — Observability

- Prometheus metrics on `:9090/metrics`: build duration, last build timestamp, build success/failure counter (NFR-OBS-1)
- `prometheus.io/scrape`, `prometheus.io/port`, `prometheus.io/path` Pod annotations so VictoriaMetrics's existing `kubernetes-pods` scrape job picks it up automatically (NFR-OBS-2). The pod's `app` label becomes the metric `job` label after scraping; it does not control whether scraping happens.
- Grafana dashboard (ConfigMap with `grafana_dashboard: "1"`)
- Whether to also scrape git-sync's own sync-duration/failure metrics, once Phase 1.5 lands — deferred out of the BRD v0.3 pass deliberately, revisit here

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

**Trigger:** personal need for DataviewJS in the published site.

## Deferred — Obsidian Bases support

Upstream `feat/bases` branch adds a static-build-time alternative to DataviewJS. Monitor for merge to `v5`.

**Trigger:** `feat/bases` merged to quartz `v5`.
