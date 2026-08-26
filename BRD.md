# Business Requirements Document — vault-publisher

## Document Control

| Field | Value |
|---|---|
| Document title | Business Requirements Document — vault-publisher |
| Document version | 0.7 (Draft) |
| System version documented | Daemon, git-sync sidecar, and Caddy serving verified end-to-end (`next-steps.md` Verify items, issue #4). K8s manifests for the three-container Pod exist in `deploy/k8s/` and are structurally validated (`kubectl kustomize`), but not yet applied to a live cluster. A documentation/implementation gap audit (v0.7) found and fixed several manifest-level issues (SSH host-key checking, a `VAULT_SYNC_PERIOD` duration-format bug, missing resource limits) that a live-cluster apply had not yet exercised. |
| Date | 2026-08-25 |
| Author | Claude Code, on behalf of the repository owner |
| Classification | Public |
| Related artifacts | [`agents.md`](agents.md), [`RISKS.md`](RISKS.md), [`README.md`](README.md), [`next-steps.md`](next-steps.md), [`deploy/k8s/`](deploy/k8s/) |

### Revision History

| Version | Date | Summary |
|---|---|---|
| 0.1 | 2026-07-28 | Initial draft. Pre-implementation; all requirements are Planned. |
| 0.2 | 2026-08-24 | MUST-priority FRs implemented (`src/`, `Dockerfile`, `quartz.config.yaml`, `package.json`). Corrected several premises found wrong during implementation: quartz is `@jackyzha0/quartz` via a git-ref dependency, not an npm-registry package; its build must run with cwd inside `node_modules/@jackyzha0/quartz`, not the app root; `QUARTZ_SHORT_NAME`/PWA manifest support doesn't exist in unpatched quartz, dropped; `rename(2)` can't replace a non-empty directory, so promotion is a two-step rename (RISK-6). Not yet built or run as a container — see `next-steps.md`. |
| 0.3 | 2026-08-24 | Proposed architecture change (docs only, no code yet): vault git cloning/pulling is delegated from the daemon to a dedicated `git-sync` sidecar (§8, §9.2). The daemon narrows to detecting a local checkout change and running the build; it no longer touches git, `VAULT_REPO_URL`, or the SSH deploy key at all. FR-POLL-* superseded by FR-SYNC-* (§9.2); FR-BUILD-1's `-d` path changes from `/vault` to `/vault/current`; `/vault` becomes daemon-read-only. `POLL_INTERVAL` now paces the daemon's local checkout check, not a network fetch — `VAULT_SYNC_PERIOD` is a new, separate var pacing git-sync's own fetch cadence. Default change-detection is self-poll (daemon reads git-sync's `current` symlink); a configurable webhook-push alternative is deferred (`next-steps.md`). See Appendix B for why this doesn't repeat the three-moving-parts problem §2 describes. |
| 0.4 | 2026-08-24 | Daemon side of v0.3 implemented — see `next-steps.md`'s "Phase 1.5 — git-sync sidecar" section for what changed. Typecheck and unit tests pass; Docker build/run still unverified end-to-end. FR-SYNC-1..5 (the git-sync sidecar container itself, and K8s manifests) remain Planned — out of this repo's code. |
| 0.5 | 2026-08-25 | Verify step executed: real image build, real `git-sync:v4.2.4` sidecar, real (throwaway) sample vault. Found and fixed a launch-blocking bug (issue #4, RISK-6): `/site` is the hostPath mount point itself, and `rename(2)` refuses to rename a mount point (`EBUSY`) even when empty — every promotion was failing, so the site never published at all. Fixed by moving `current`/`next`/`old` to be sibling subdirectories under `/site` instead of top-level mount paths (FR-BUILD-1/2 updated accordingly); Caddy's document root is now `/site/current`, not `/site`. Re-verified after the fix: build succeeds, a second vault commit triggers a rebuild, output is correctly published. Also confirmed RISK-10 (git-sync worktree dirs are named deterministically by commit SHA) and that `/vault/current` tracks the configured branch. |
| 0.6 | 2026-08-25 | Caddy integration verified end-to-end (previously untested — the v0.5 Verify pass covered git-sync/build/promote but not serving): a real Caddy container against the same throwaway sample vault served the build correctly and stayed at 200 across a rebuild/promotion cycle under continuous request load (`next-steps.md`). K8s manifests for the three-container Pod written (`deploy/k8s/`) — FR-SYNC-1..5, NFR-SEC-1 move to Implemented (manifest declares the behavior; git-sync's own runtime behavior beyond §9.2/RISK-10's scope, and the manifest's correctness against a live cluster, remain unverified — no cluster was available). NFR-OBS-2's annotations added to the Deployment template ahead of Phase 2 (inert until `:9090/metrics` exists). |
| 0.7 | 2026-08-25 | Documentation/implementation gap audit against `deploy/k8s/` and `src/`, all still unverified against a live cluster: (1) `configmap.yaml`'s `VAULT_SYNC_PERIOD` default changed from a bare `"300"` to `"300s"` — git-sync parses `GITSYNC_PERIOD` as a Go duration, which requires a unit; a bare integer would have failed to parse on first apply, uncaught by the Docker-based Verify pass because it hardcodes `--period=10s` directly instead of going through this env var. (2) `deployment.yaml`'s git-sync container now sets `GITSYNC_SSH_KNOWN_HOSTS=false`, since no known_hosts file is mounted and git-sync defaults to strict host-key checking — the SSH path was already flagged unverified in `next-steps.md`; this was the specific reason it would have failed. (3) `SSH_KEY_PATH` moved from a hardcoded literal in `deployment.yaml` to a `configmap.yaml` key both containers reference, per One Source of Truth. (4) Added `resources.limits`/`requests` to the `builder` container — RISK-5's mitigation was documented but absent from the manifest. (5) FR-CFG-3 corrected from Planned to Implemented (the code already supports a mounted config override; only the manifest example and docs were missing). (6) §8's `:9090/metrics` narrative corrected to read as not-yet-implemented, matching NFR-OBS-1's status. (7) `README.md`'s `.build-info` troubleshooting path corrected to `current/.build-info`. |

### Approval

| Role | Name | Date |
|---|---|---|
| Product Owner | *(repository owner)* | |

---

## 1. Executive Summary

vault-publisher publishes an Obsidian vault as a static website using [Quartz](https://quartz.jzhao.xyz/). A `git-sync` sidecar keeps a local checkout of the vault's git repository up to date; the vault-publisher daemon detects checkout changes, builds the site, and persists the output; a Caddy sidecar serves it. It replaces a CronJob-based approach (a Quartz fork run periodically by k3s, with a separate web server sidecar) with three single-purpose long-running processes — sync, build, serve — without requiring CronJob orchestration, shell-script configuration injection, or a quartz fork.

The system is deliberately generic: it serves any Obsidian vault accessible via a git remote. Personal configuration is injected entirely at runtime via environment variables and Kubernetes Secrets, keeping the image free of personal identifiers and publishable as a standalone open-source tool.

## 2. Business Background & Problem Statement

The operator previously ran a fork of [jackyzha0/quartz](https://github.com/jackyzha0/quartz) as a k3s CronJob to publish a personal knowledge vault as a static site. This approach had three compounding problems:

1. **Fork maintenance overhead.** Every upstream quartz release required a rebase. Non-trivial changes (plugin install architecture, Dockerfile structure) were inherited silently or required manual cherry-picks.
2. **Operational complexity.** A shell-script entrypoint injected config via `envsubst` at container startup. A separate CronJob orchestrated the build. A web server sidecar served the output. Three concerns, three moving parts, coordinated by k8s manifests.
3. **Cold-start cost on constrained hardware.** The CronJob used ephemeral storage (`emptyDir`), so every pod restart triggered a full `git clone` + full `npx quartz build`. On a 2-node RPi5 4GB cluster already running ~650 MB of workloads, this is a meaningful spike.

The replacement design addresses all three: quartz as a versioned npm dependency eliminates fork debt; a single long-running container owns the full build cycle; `hostPath` persistence means restarts are incremental (`git pull` + conditional rebuild) rather than cold starts.

## 3. Goals & Objectives

| # | Goal | Measure |
|---|---|---|
| G1 | Publish any Obsidian vault as a Quartz static site from a git remote | Site accessible via Caddy within one `POLL_INTERVAL` of a vault commit |
| G2 | Rebuild automatically on vault changes without manual intervention | Daemon detects HEAD change and rebuilds without operator action |
| G3 | Survive pod restarts without a full cold-start rebuild | On restart, Caddy serves the previous build immediately; rebuild only if HEAD changed |
| G4 | Run sustainably on RPi5 4GB alongside existing cluster workloads | Peak build RAM < 500 MB; idle resident RAM < 100 MB |
| G5 | Eliminate quartz fork maintenance overhead | quartz version = a single `package.json` field; no local patches |
| G6 | Be publishable as a generic open-source tool with zero personal identifiers | No domains, hostnames, usernames, or vault content in the committed image or repo |

## 4. Scope

### 4.1 In Scope

- A Docker image containing: Node.js runtime, `git`, `@jackyzha0/quartz` (git-ref-pinned dependency), a poll-build daemon, and a default `quartz.config.yaml` with env var placeholders.
- A daemon entrypoint that: clones the vault on first run (or pulls on subsequent runs), runs `npx quartz build` when HEAD changes, writes output atomically to `/site`.
- Configurable poll interval, git remote, branch, and quartz site parameters via environment variables.
- SSH deploy key support for private vault repos.
- A GitHub Actions CI workflow (`ci.yml`) that lints, tests, scans, builds, and pushes the image to GHCR.
- Kubernetes deployment documentation (three-container Pod — git-sync, builder, Caddy — `hostPath` volumes, `nodeSelector`).

### 4.2 Out of Scope

| Item | Why |
|---|---|
| Built-in web server | Caddy sidecar handles serving; image should not bundle a second HTTP server |
| Quartz plugin authoring or forking | quartz is a black-box dependency; plugins are installed by quartz's own install step |
| Vault write-back / sync | This system is read-only with respect to the vault; it clones and pulls, never pushes |
| Authentication / access control on the served site | Delegated to the ingress layer (Traefik, Cloudflare Tunnel, etc.) |
| Multi-vault support in a single container | One container, one vault; run multiple containers for multiple vaults |
| DataviewJS pre-rendering | Deferred; tracked in `next-steps.md` |
| Obsidian Bases support | Upstream `feat/bases` not yet merged; deferred |

## 5. Stakeholders & Roles

| Role | Interest |
|---|---|
| Operator / self-hoster | Deploys the image to their k3s cluster; configures vault git remote and site parameters |
| End user | Reads the published static site via a browser |
| Upstream (Quartz) | Defines the build toolchain this image depends on |
| Open-source community | May fork or adapt for their own vault publishing setup |

## 6. Assumptions & Constraints

- **A1.** The vault is an Obsidian-format Markdown tree in a git repository accessible by the container (SSH or HTTPS).
- **A2.** The vault contains a valid `quartz.config.yaml` or the image's default config is used (env var overrides apply).
- **A3.** The deployment target is a single-node `hostPath`-capable Kubernetes cluster or Docker Compose for local dev.
- **A4.** The Caddy sidecar is the only consumer of `/site`; no other process writes to that volume.
- **C1.** The image must contain no personal identifiers — no domains, hostnames, usernames, vault content, or personal infrastructure specifics.
- **C2.** Build output must never be partially visible during a write. Atomic rename from a staging path is mandatory.
- **C3.** quartz (`@jackyzha0/quartz`, installed via a git-ref-pinned dependency — it is `private: true` and not published to the npm registry) must remain unpatched. Any required behavior change must be achieved via config, not code patches.
- **C4.** The system only publishes Obsidian features natively supported by the upstream Quartz parser; unsupported elements (e.g., Canvas, Excalidraw, complex plugins) will degrade gracefully or be ignored.

## 7. Glossary

| Term | Meaning |
|---|---|
| Vault | An Obsidian-format Markdown tree tracked in a git repository |
| Daemon | The long-running container process that detects vault checkout changes and triggers builds |
| git-sync | Sidecar container that owns cloning/pulling the vault repo into `/vault`; the daemon has no git access |
| Poll interval (`POLL_INTERVAL`) | Seconds between the daemon's checks of `/vault/current`; a build only fires when it has changed since the last build |
| Sync period (`VAULT_SYNC_PERIOD`) | Seconds between git-sync's own fetch/pull cycles — independent of `POLL_INTERVAL` |
| `/vault` | hostPath directory git-sync writes the vault checkout into (rw for git-sync, ro for the daemon) |
| `/vault/current` | Symlink git-sync maintains, always pointing at the latest successfully synced worktree |
| `/site` | hostPath mount point; contains `current`/`next`/`old` subdirectories (the mount point itself can't be renamed — RISK-6/issue #4) |
| `/site/current` | The built static site actually served by Caddy |
| `/site/next` | Staging directory; build output written here, then renamed to `/site/current` atomically |
| Quartz | The upstream static site generator; used as an unpatched npm dependency |
| Caddy | Lightweight HTTP server deployed as a sidecar, reading from `/site/current` |
| hostPath | Kubernetes volume type backed by a directory on the node's local disk |

## 8. System Context & Architecture

```
Vault git repo (any host — SSH or HTTPS)
  │
  │ git clone (first run) / git fetch + pull, every VAULT_SYNC_PERIOD
  ▼
┌───────────────────────────────────────────────┐
│  Pod (pinned to Node 1 via nodeSelector)       │
│                                                 │
│  ┌─────────────────────┐                       │
│  │  git-sync sidecar   │                       │
│  │                     │                       │
│  │  clone/pull → /vault/rev-<sha>               │
│  │  update symlink /vault/current               │
│  └──────────┬──────────┘                       │
│             │ hostPath: /vault (rw for git-sync,│
│             │           ro for vault-publisher) │
│  ┌──────────┴──────────┐                       │
│  │  vault-publisher    │                       │
│  │  (builder daemon)   │                       │
│  │                     │                       │
│  │  loop:              │                       │
│  │    readlink /vault/current                  │
│  │    if changed since last build:              │
│  │      quartz build -d /vault/current          │
│  │      → /site/next                           │
│  │      rename → /site/current                 │
│  │    sleep POLL_INTERVAL                       │
│  └──────────┬──────────┘                       │
│             │ hostPath: /site (rw)              │
│  ┌──────────┴──────────┐                       │
│  │  Caddy sidecar      │                       │
│  │  serves /site/current (ro)                  │
│  └──────────┬──────────┘                       │
└─────────────┼───────────────────────────────────┘
              │ HTTP
              ▼
         Traefik ingress → Cloudflare Tunnel → Browser
```

The daemon will also expose `:9090/metrics` (Prometheus text exposition format), scraped in-cluster by VictoriaMetrics via `prometheus.io/*` Pod annotations — not routed through Traefik/ingress (NFR-OBS-1, NFR-OBS-2). **Not yet implemented** — the annotations are already on the Deployment template (inert until the endpoint exists), but no metrics code exists in `src/` yet; see Phase 2, `next-steps.md`. git-sync's own metrics are out of scope for this pass (`next-steps.md`).

Component responsibilities:

| Component | Responsibility | Writes to vault remote? | Writes to `/vault`? |
|---|---|---|---|
| git-sync sidecar | Clone/pull `VAULT_REPO_URL` into `/vault`, maintain the `current` symlink | No (clone/pull only, §12) | Yes (sole writer) |
| vault-publisher daemon | Detect `/vault/current` change, quartz build, atomic `/site/current` swap, expose `/metrics` | No | No (read-only mount) |
| Caddy sidecar | Serve `/site/current` over HTTP | No | No |
| Traefik / ingress | TLS termination, routing | No | No |

## 9. Functional & Non-Functional Requirements

### 9.1 Numbering Convention

Requirements use `FR-<AREA>-<n>` / `NFR-<AREA>-<n>`. Priority uses MoSCoW. Status: `Planned` (pre-implementation), `Implemented` (code exists — see `next-steps.md` for what has and hasn't been run end-to-end), or `Blocked` where an external dependency must land first.

### 9.2 Vault Sync (`SYNC`)

Owned by the `git-sync` sidecar (`registry.k8s.io/git-sync/git-sync`), not the daemon — a deliberate change from v0.2, where the daemon did its own clone/fetch (see revision history, Appendix B). Flag names below reflect git-sync's typical interface; confirm against the pinned image tag when this is implemented. Superseded requirements: FR-POLL-1/2/4/5 (v0.2) → FR-SYNC-1/2/3 below; FR-POLL-3 → FR-BUILD-7 (§9.3), since the sleep loop moves to the daemon's local-change check.

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-SYNC-1 | On startup, git-sync SHALL clone `VAULT_REPO_URL` into `/vault` (its `--root`) if not already present; otherwise it SHALL pull. It SHALL maintain a `current` symlink (`--link=current`) inside `/vault` that always points at the latest successfully synced worktree. | Must | Implemented (`deploy/k8s/deployment.yaml`; behavior itself confirmed via `docker-compose.verify.yml`, not the manifest directly — no live cluster available) |
| FR-SYNC-2 | git-sync SHALL sync on `VAULT_SYNC_PERIOD` seconds (`--period`). | Must | Implemented (as above) |
| FR-SYNC-3 | SSH key at `SSH_KEY_PATH` SHALL be used for git operations when present (`--ssh`, `--ssh-key-file`); HTTPS is used otherwise. | Must | Implemented (manifest only — SSH auth itself still unverified, see `next-steps.md`'s Verify item) |
| FR-SYNC-4 | A sync failure SHALL be logged and retried on git-sync's own backoff; it SHALL NOT stop the `current` symlink from pointing at the last good sync, and SHALL NOT crash the sidecar. | Must | Planned (upstream git-sync behavior, not something this repo configures or has verified) |
| FR-SYNC-5 | `/vault` SHALL be mounted read-write by the git-sync container and read-only by the daemon container. | Must | Implemented (`deploy/k8s/deployment.yaml`) |

### 9.3 Daemon — Build (`BUILD`)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-BUILD-1 | From within `node_modules/@jackyzha0/quartz` (quartz resolves its own build scripts and config relative to `process.cwd()`, not its install path), the daemon SHALL invoke `quartz build -d <resolved-dir> --output /site/next`, where `<resolved-dir>` is `/vault/current` resolved to a concrete path once per poll cycle (FR-BUILD-7), not the live symlink — this pins the build to one snapshot even if git-sync retargets the symlink mid-build (RISK-9). (v0.2: `-d /vault`, before vault sync moved to a git-sync sidecar — see §9.2.) | Must | Implemented |
| FR-BUILD-2 | On build success, the daemon SHALL promote `/site/next` to `/site/current`. `rename(2)` cannot replace a non-empty directory (`ENOTEMPTY`) and cannot rename a mount point itself (`EBUSY`, confirmed live against a real hostPath-style bind mount — issue #4), so `current`/`next`/`old` are sibling subdirectories under the `/site` mount, never `/site` itself; promotion after the first build is two renames — `current` → `old`, then `next` → `current` — with `old` removed after. See RISK-6. | Must | Implemented |
| FR-BUILD-3 | On build failure, `/site/current` SHALL remain unchanged (the previous successful build continues to be served). | Must | Implemented |
| FR-BUILD-4 | Before invoking quartz, the daemon SHALL substitute env var placeholders in `quartz.config.yaml` using `envsubst`. | Must | Implemented |
| FR-BUILD-5 | A build SHALL also be triggered on the first startup even if `/vault` already exists and HEAD has not changed, to ensure `/site/current` is populated after a config change. | Should | Planned |
| FR-BUILD-6 | A build SHOULD be incremental, rebuilding only files changed since the last build, once quartz supports this for a one-shot (non-watch) invocation. Until then, every build is a full rebuild (FR-BUILD-1). See `next-steps.md` Phase 3. | Could | Blocked |
| FR-BUILD-7 | On each `POLL_INTERVAL` tick, the daemon SHALL resolve `/vault/current` to a concrete directory (`realpath`, not a raw `readlink`) and compare it to the value at its last build; a build (FR-BUILD-1) SHALL fire only when it differs, using that same resolved directory as the build input. This replaces v0.2's `git fetch`-based change detection (FR-POLL-2) now that sync is external (§9.2). | Must | Implemented (`src/vault.ts`) |
| FR-BUILD-8 | The daemon MAY be configured to trigger a build via an inbound webhook call from git-sync instead of polling `/vault/current` (FR-BUILD-7), for near-instant builds instead of `POLL_INTERVAL`-bounded latency. Deferred — see `next-steps.md`. | Could | Planned |
| FR-BUILD-9 | The daemon SHALL NOT initiate a new build if a previous build is still in progress (e.g., if a build takes longer than `POLL_INTERVAL`). | Must | Planned |

### 9.4 Configuration (`CFG`)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-CFG-1 | All site-specific parameters (`QUARTZ_BASE_URL`, `QUARTZ_PAGE_TITLE`) SHALL be injected via environment variables into the daemon container, not baked into the image. Vault-access parameters (`VAULT_REPO_URL`, `VAULT_BRANCH`, `SSH_KEY_PATH`, `VAULT_SYNC_PERIOD`) are injected the same way into the git-sync container instead (§9.2) — the daemon no longer receives them. | Must | Implemented |
| FR-CFG-2 | A default `quartz.config.yaml` SHALL be included in the image, with `${QUARTZ_*}` placeholders, covering a working general-purpose Quartz configuration. | Must | Implemented |
| FR-CFG-3 | Operators MAY override the default config by mounting a custom `quartz.config.yaml` at the app root. | Should | Implemented (`substituteConfig` in `src/build.ts` always reads `quartz.config.yaml` from `process.cwd()`, unconditionally — a mounted override needs no daemon code change; documented in `README.md`. Not yet exercised against a real ConfigMap mount) |

**Non-Functional**

| ID | Requirement | Priority | Status |
|---|---|---|---|
| NFR-POLL-1 | Idle resident RAM (between builds) SHALL be < 100 MB. | Must | Planned |
| NFR-BUILD-1 | Peak RAM during a quartz build SHALL be < 500 MB. | Must | Planned |
| NFR-BUILD-2 | Caddy SHALL never serve a partially-written build; the two-step rename (FR-BUILD-2) is the sole mechanism guaranteeing this. A momentary 404 during the rename gap is acceptable; mixed old/new content is not. | Must | Implemented |
| NFR-BUILD-3 | The image SHALL include `node_modules` pre-installed; no `npm install` SHALL run at pod startup. | Must | Implemented |
| NFR-BUILD-4 | The image SHOULD be published for both `linux/amd64` and `linux/arm64` so operators without ARM hardware can run it. CI currently builds `linux/arm64` only, deliberately, on a native runner to avoid QEMU-emulated native compilation slowdowns (see `ci.yml`). | Should | Planned |
| NFR-CFG-1 | The committed image and repo SHALL contain no personal identifiers (domains, hostnames, usernames, vault content). | Must | Planned |
| NFR-OBS-1 | The daemon SHALL expose Prometheus-format metrics — build duration, last build timestamp, build success/failure counter — on `:9090/metrics`, unauthenticated. | Could | Planned |
| NFR-OBS-2 | The Pod SHALL carry `prometheus.io/scrape`, `prometheus.io/port`, and `prometheus.io/path` annotations so VictoriaMetrics's existing annotation-based scrape job picks it up automatically; no dedicated ServiceMonitor or scrape config. | Could | Planned |

## 10. Data Requirements

| Data | Location | Notes |
|---|---|---|
| Vault git clone | `/vault` (hostPath) | Persists across pod restarts; written only by git-sync (rw); daemon mounts read-only and reads `/vault/current` |
| Built static site | `/site/current` (subdirectory of the `/site` hostPath mount) | Persists across pod restarts; always a complete, consistent snapshot |
| Build staging | `/site/next` | Ephemeral; created per build, renamed to `/site/current` on success, deleted on failure |
| quartz config | `node_modules/@jackyzha0/quartz/quartz.config.yaml` | Must live inside the installed quartz package — quartz resolves config relative to `process.cwd()`, not its install path (see `agents.md`). Default baked into image; overridable via ConfigMap mount |
| SSH deploy key | `SSH_KEY_PATH` (K8s Secret mount) | Must be `0400`; mounted into the git-sync container only, read at its startup — the daemon container never has this key |

## 11. Interface Requirements

| Interface | Details |
|---|---|
| Git remote | SSH (preferred for private repos) or HTTPS; configured via `VAULT_REPO_URL` on the git-sync container — the daemon has no git remote interface at all (§9.2) |
| HTTP (served site) | Caddy listens on port 80 inside the Pod; Traefik ingress terminates TLS externally |
| Metrics (Prometheus) | Daemon exposes `:9090/metrics` (text exposition format); scraped in-cluster only via `prometheus.io/*` pod annotations (NFR-OBS-1/2) — not routed through ingress |
| CI | GitHub Actions `ci.yml`; publishes to `ghcr.io/<owner>/vault-publisher:latest` |

## 12. Security & Compliance Requirements

| ID | Requirement | Priority | Status |
|---|---|---|---|
| NFR-SEC-1 | SSH deploy keys SHALL be read-only (`0400`) and mounted from a K8s Secret into the git-sync container, never committed to the repo. | Must | Implemented (`deploy/k8s/deployment.yaml`'s `ssh-key` volume, `defaultMode: 0400`; `secret.example.yaml` is a template, never real key material) |
| NFR-SEC-2 | The git-sync sidecar SHALL NOT push to the vault repo; it clones/pulls only. Nothing else in the Pod has git access. | Must | Implemented (manifest grants no other container git access; git-sync's own push behavior is upstream, unverified here) |
| NFR-SEC-3 | No personal identifiers SHALL be committed to this repository (see C1). | Must | Implemented (`deploy/k8s/` uses placeholders — `REPLACE_WITH_NODE_NAME`, `vault.example.com`, `git@example.com:...` — not real values) |
| NFR-SEC-4 | The built static site is unauthenticated by design; access control is the ingress layer's responsibility. If ingress lacks authentication, vault content is entirely public. | Must | Implemented (`deploy/k8s/service.yaml` is ClusterIP only; no auth, ingress is explicitly out of scope) |
| NFR-SEC-5 | The daemon container SHALL have no access to the SSH deploy key or any git credential, and SHALL mount `/vault` read-only. | Must | Implemented (code has no git/SSH access; the read-only mount itself is a K8s manifest concern, still Planned) |

## 13. Observability & Monitoring Requirements

Minimum viable observability for initial deployment:

| Signal | Mechanism |
|---|---|
| Build success / failure | Logged to stdout with timestamp and vault HEAD SHA |
| Last successful build | Logged; optionally written to `/site/current/.build-info` |
| Pod readiness | `readinessProbe` (HTTP GET `/` on the caddy container, `deploy/k8s/deployment.yaml`) — deliberately readiness, not liveness, so RISK-2's one-time pre-first-build window gates traffic instead of crash-looping a container that isn't actually broken |

Prometheus metrics are specified (NFR-OBS-1, NFR-OBS-2; Status: Planned, Phase 2 — see `next-steps.md`). A Grafana dashboard remains deferred.

## 14. Success Metrics / Acceptance Criteria

- **G1:** Site is reachable via browser within `POLL_INTERVAL` seconds of a vault commit.
- **G2:** A `git push` to the vault repo results in a rebuilt site with no operator action.
- **G3:** After a pod restart, the previous build is immediately served; a rebuild only fires if HEAD changed.
- **G4:** `kubectl top pod` shows < 100 MB during idle, < 500 MB peak during build.
- **G5:** `package.json` is the sole reference to the quartz version; no local patches exist.
- **G6:** `git grep` finds no personal domains, hostnames, or usernames in the committed repo.

## 15. Appendices

### Appendix A — Related Documents

- [`agents.md`](agents.md) — hard rules and non-obvious operational gotchas
- [`RISKS.md`](RISKS.md) — risk register
- [`next-steps.md`](next-steps.md) — deferred work and phase roadmap
- [`README.md`](README.md) — user-facing setup guide
- [jackyzha0/quartz](https://github.com/jackyzha0/quartz) — upstream static site generator (unpatched dependency)

### Appendix B — Rejected Alternatives

| Alternative | Why rejected |
|---|---|
| Fork quartz and run as CronJob | Rebase debt; three separate concerns (build, config injection, serving) with no single owner |
| `emptyDir` instead of `hostPath` | Full cold-start rebuild on every pod restart — unacceptable on RPi5 4GB |
| Hand-roll git clone/fetch/SSH-key handling in the daemon (v0.1–0.2 approach) | Duplicates logic a purpose-built, widely-used upstream project (`git-sync`) already solves, including edge cases (shallow clones, auth retries, ref resolution) this repo never exercised in production. Delegating it also lets the daemon drop write access to `/vault` and the SSH key entirely, narrowing its blast radius (see NFR-SEC-5, issue #8). |
| git-sync's `exechook` calling the daemon directly | `exechook` execs a command inside git-sync's own container filesystem — it cannot reach across the container boundary to invoke the daemon's `quartz build`. Ruled out for this reason, not on merit. |
| `quartz build --serve` as the entrypoint | Keeps quartz process resident in memory permanently; less RAM-efficient than ephemeral builds |
| NAS-backed PVC for `/site` | Adds NAS dependency to serving path; `hostPath` is simpler and already used by Postgres on this cluster |

**Why three containers here doesn't repeat §2's "three moving parts" complaint:** the old CronJob design's three concerns (build, config injection via `envsubst` shell scripts, serving) were coupled through a forked quartz and had no single clear owner. This design's three containers — git-sync, daemon, Caddy — each own exactly one concern, communicate only through a read-only filesystem handoff (`/vault/current`, `/site`), and two of the three (git-sync, Caddy) are off-the-shelf, unpatched, zero-maintenance images. Only the daemon is custom code, and it is now *smaller* than the v0.2 daemon, not larger.
