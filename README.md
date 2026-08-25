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

This repo doesn't own a deployment pipeline — it publishes an image (`ghcr.io/<owner>/vault-publisher`) and documents how to run it. [`deploy/k8s/`](deploy/k8s/) is a worked **example**, not something applied from this repo; copy it into your own cluster-config repo and adapt it.

### Architecture

A three-container Kubernetes Pod, tied to one node via `nodeSelector` (both volumes below are `hostPath`):

| Container | Image | Role |
|---|---|---|
| `git-sync` | `registry.k8s.io/git-sync/git-sync` | clone/pull the vault repo into `/vault` |
| `builder` | `ghcr.io/<owner>/vault-publisher` | detect `/vault/current` change + quartz build |
| `caddy` | `caddy:alpine` | static file server |

| Path | Purpose |
|---|---|
| `/vault` | git checkout of the vault repo, maintained by git-sync (rw for git-sync, ro for `builder`; persists across restarts) |
| `/site` | hostPath mount; `current`/`next`/`old` live as subdirectories inside it (the mount point itself can't be renamed — see `agents.md`). Caddy serves `/site/current`, which persists across restarts |

### Configure and deploy

1. **Pick a node** and create the two hostPath directories on it (e.g. `/mnt/vault-publisher/{vault,site}`) — or let `DirectoryOrCreate` make them on first apply, as `deploy/k8s/deployment.yaml` does.
2. **Create the secrets** git-sync needs (never commit these — see `deploy/k8s/secret.example.yaml`'s header):
   ```
   kubectl create secret generic vault-publisher-repo --from-literal=VAULT_REPO_URL=<your-vault-git-url>
   kubectl create secret generic vault-publisher-ssh-key --from-file=id_ed25519=<path-to-deploy-key>
   ```
   Skip the SSH key secret (and drop `GITSYNC_SSH`/the `ssh-key` volume from `deployment.yaml`) if the repo is HTTPS-public.
3. **Copy `deploy/k8s/`** into your own config and fill in the placeholders:
   - `configmap.yaml`: `QUARTZ_BASE_URL` (required — no protocol, no trailing slash), and any of `VAULT_BRANCH`/`VAULT_SYNC_PERIOD`/`POLL_INTERVAL`/`QUARTZ_PAGE_TITLE` you want to override
   - `deployment.yaml`: `nodeSelector`'s `REPLACE_WITH_NODE_NAME`, the `builder` image (`ghcr.io/OWNER/vault-publisher:latest`), and the two hostPath `path`s if you're not using the defaults
4. **Apply**: `kubectl apply -k deploy/k8s` (or `kubectl kustomize deploy/k8s | kubectl apply -f -`)
5. **Point your ingress** (Traefik, Cloudflare Tunnel, etc.) at the `vault-publisher` Service, port 80. TLS termination and routing are the ingress layer's job — out of scope here.

### Verify it's working

- `kubectl get pods -l app=vault-publisher` — all three containers `Ready`. The `caddy` container's `readinessProbe` stays `0/1` until the first build completes (expected — see RISK-2), not a crash.
- `kubectl logs -l app=vault-publisher -c builder` — should show a build firing shortly after git-sync's first successful clone, then `Up to date` on later polls.
- `curl` the Service (or your ingress URL) and confirm the site loads.

### Updating

- **New image version**: bump the `builder` image tag in `deployment.yaml` and re-apply. `strategy: Recreate` means a brief full-Pod restart (hostPath can't be shared by two Pods at once) — the previous `/site/current` build keeps being served by Caddy right up until the old Pod terminates.
- **Config-only change** (e.g. `QUARTZ_PAGE_TITLE`): re-apply the ConfigMap, then delete `.build-info` from the `/site` hostPath directory before restarting the Pod. A restart alone is **not** enough — the last-built vault ref persists in `/site/current/.build-info` (G3, so a restart doesn't force a needless rebuild), so if the vault hasn't also changed, the builder just logs "Up to date" and the old config keeps being served. Automatic pickup on every restart is tracked as FR-BUILD-5 (currently Planned).

### Troubleshooting

- **Caddy 404 right after first deploy**: expected until the first build completes (RISK-2); the readiness probe should flip once it does.
- **git-sync never syncs / SSH errors**: check the `git-sync` container's logs and that the SSH key Secret is exactly the private key file contents (`kubectl create secret generic ... --from-file=id_ed25519=<key>`, not `--from-literal`).
- **Local testing without a cluster**: `docker-compose.verify.yml` runs the same three-container chain against a throwaway sample vault (`./deploy/verify/make-sample-vault.sh` first) — useful for validating a Caddyfile or config change before touching the real cluster.

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
