# vault-publisher

A self-contained Docker daemon that polls an Obsidian vault git repository, builds it as a static site using [Quartz](https://quartz.jzhao.xyz/), and serves it via a Caddy sidecar — no CronJob orchestration, no manual rebuild triggers.

## How it works

```
Vault git repo (any host)
  │ git clone / git pull (periodic)
  ▼
vault-publisher container
  │ quartz build -d /vault --output /site-next → atomic rename → /site
  ▼
hostPath /site (node-local disk)
  │ read-only mount
  ▼
Caddy sidecar → Traefik / ingress
```

The builder daemon polls `git fetch` on a configurable interval. When the remote HEAD differs from the local HEAD, it rebuilds. Output is written to a staging directory and atomically renamed so Caddy always serves a consistent snapshot, never a partially-written build.

## Deployment

Designed for a two-container Kubernetes Pod:

| Container | Image | Role |
|---|---|---|
| `builder` | `ghcr.io/<owner>/vault-publisher` | git poll + quartz build |
| `caddy` | `caddy:alpine` | static file server |

Both containers share two `hostPath` volumes:

| Path | Purpose |
|---|---|
| `/vault` | git clone of the vault repo (persists across restarts) |
| `/site` | built static site (persists across restarts; Caddy serves this) |

A `nodeSelector` is required because `hostPath` ties the Pod to one node.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `VAULT_REPO_URL` | yes | — | Git remote URL of the vault (SSH or HTTPS) |
| `VAULT_BRANCH` | no | `main` | Branch to track |
| `POLL_INTERVAL` | no | `300` | Seconds between `git fetch` checks |
| `QUARTZ_BASE_URL` | yes | — | Base URL served by Caddy (no protocol, no trailing slash) |
| `QUARTZ_PAGE_TITLE` | no | `My Vault` | Site title |
| `SSH_KEY_PATH` | no | `/ssh/id_ed25519` | Path to SSH deploy key (for private repos) |

## quartz configuration

vault-publisher depends on [`@jackyzha0/quartz`](https://github.com/jackyzha0/quartz) as a git-ref-pinned dependency (it isn't published to the npm registry) — never forked or patched. The included `quartz.config.yaml` is a general-purpose default; override `pageTitle`/`baseUrl` at deploy time via environment variables (substituted by the daemon before each build). For full control, mount a custom `quartz.config.yaml` via a ConfigMap.

Unpatched quartz has no PWA/manifest support, so there's no app short-name or install-to-homescreen option.

## License

MIT
