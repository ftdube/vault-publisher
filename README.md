# vault-publisher

A self-contained Docker daemon that builds an Obsidian vault as a static site using [Quartz](https://quartz.jzhao.xyz/) whenever a [`git-sync`](https://github.com/kubernetes/git-sync) sidecar pulls a change, and serves it via a Caddy sidecar — no CronJob orchestration, no manual rebuild triggers.

> **Note:** verified end-to-end (including Caddy) against a real `git-sync` sidecar and a throwaway sample vault — see `next-steps.md`'s Verify items. K8s manifests exist in `deploy/k8s/` but haven't been applied to a live cluster yet.

## How it works

```
Vault git repo (any host)
  │ git clone / git pull, every VAULT_SYNC_PERIOD
  ▼
git-sync sidecar → /vault/current (symlink, always latest)
  ▼
vault-publisher container (reads /vault read-only)
  │ quartz build -d /vault/current --output /site/next → atomic rename → /site/current
  ▼
hostPath /site (node-local disk)
  │ read-only mount, Caddy serves /site/current
  ▼
Caddy sidecar → Traefik / ingress
```

The git-sync sidecar owns all git operations — clone, pull, SSH/HTTPS auth — on a configurable interval, and maintains a `current` symlink pointing at the latest synced checkout. The builder daemon has no git access at all: it polls that local symlink, and when it has changed since the last build, rebuilds. Output is written to a staging directory and atomically renamed so Caddy always serves a consistent snapshot, never a partially-written build.

## Deployment

Designed for a three-container Kubernetes Pod:

| Container | Image | Role |
|---|---|---|
| `git-sync` | `registry.k8s.io/git-sync/git-sync` | clone/pull the vault repo into `/vault` |
| `builder` | `ghcr.io/<owner>/vault-publisher` | detect `/vault/current` change + quartz build |
| `caddy` | `caddy:alpine` | static file server |

Two `hostPath` volumes are shared:

| Path | Purpose |
|---|---|
| `/vault` | git checkout of the vault repo, maintained by git-sync (rw for git-sync, ro for `builder`; persists across restarts) |
| `/site` | hostPath mount; `current`/`next`/`old` live as subdirectories inside it (the mount point itself can't be renamed — see `agents.md`). Caddy serves `/site/current`, which persists across restarts |

A `nodeSelector` is required because `hostPath` ties the Pod to one node.

Ready-to-adapt manifests live in [`deploy/k8s/`](deploy/k8s/) (`kubectl kustomize deploy/k8s`). Copy `secret.example.yaml`, fill in real values, and replace the `REPLACE_WITH_*` placeholders in `deployment.yaml` and `configmap.yaml` before applying. For local end-to-end testing without a cluster, see `docker-compose.verify.yml`.

## Environment variables

Vault-access variables go on the `git-sync` container; site/build variables go on the `builder` container — the builder has no use for git credentials at all.

| Variable | Container | Required | Default | Description |
|---|---|---|---|---|
| `VAULT_REPO_URL` | git-sync | yes | — | Git remote URL of the vault (SSH or HTTPS) |
| `VAULT_BRANCH` | git-sync | no | `main` | Branch to track |
| `VAULT_SYNC_PERIOD` | git-sync | no | `300` | Seconds between sync (clone/pull) cycles |
| `SSH_KEY_PATH` | git-sync | no | `/ssh/id_ed25519` | Path to SSH deploy key (for private repos), mounted `0400` |
| `POLL_INTERVAL` | builder | no | `300` | Seconds between the builder's checks of `/vault/current` |
| `QUARTZ_BASE_URL` | builder | yes | — | Base URL served by Caddy (no protocol, no trailing slash) |
| `QUARTZ_PAGE_TITLE` | builder | no | `My Vault` | Site title |

## quartz configuration

vault-publisher depends on [`@jackyzha0/quartz`](https://github.com/jackyzha0/quartz) as a git-ref-pinned dependency (it isn't published to the npm registry) — never forked or patched. The included `quartz.config.yaml` is a general-purpose default; override `pageTitle`/`baseUrl` at deploy time via environment variables (substituted by the daemon before each build). For full control, mount a custom `quartz.config.yaml` via a ConfigMap.

Unpatched quartz has no PWA/manifest support, so there's no app short-name or install-to-homescreen option.

## License

MIT
