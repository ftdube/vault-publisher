# vault-publisher

Daemon that builds an Obsidian vault as a static site with Quartz whenever a `git-sync` sidecar syncs a change, and persists the output for a Caddy sidecar to serve. Designed for low-power k3s clusters.

## Hard rules

- Never bake vault content, personal domains, hostnames, or credentials into the image
- `VAULT_REPO_URL`/`VAULT_BRANCH`/`SSH_KEY_PATH` are injected into the `git-sync` sidecar; `QUARTZ_BASE_URL`/`QUARTZ_PAGE_TITLE`/`POLL_INTERVAL` into the daemon — both via env vars / K8s Secrets
- `@jackyzha0/quartz` is a git-ref-pinned dependency (`private: true`, not on the npm registry) — do not fork or patch it; upgrades are a `package.json` ref bump
- Build output is written to `/site/next`, then renamed to `/site/current` — never write directly to `/site/current` mid-build; never rename the `/site` mount point itself (see gotcha below)

## Non-obvious gotchas

- no git code in the daemon (`src/git.ts` deleted) — reads git-sync's `/vault/current` symlink only (BRD §9.2); `/vault` is read-only for the daemon
- quartz's build must run with cwd = `node_modules/@jackyzha0/quartz` (config/scripts resolve relative to `process.cwd()`, not install path) — see `agent-archive.md`
- quartz has no native PWA/manifest support — dropped rather than patched (see `agent-archive.md`)
- `hostPath` for `/vault` and `/site` ties the Pod to one node — `nodeSelector` required; loss of that node means service loss
- `/site` is the hostPath mount point itself — `rename(2)` on it fails `EBUSY` even when empty (issue #4); `current`/`next`/`old` are subdirectories instead. Caddy's root MUST be `/site/current`
- `/site/current` doesn't exist until the first build completes — Caddy 404s during that one-time window only
- quartz's `node_modules` and community plugins are pre-baked into the image, never installed/built at runtime — see `agent-archive.md`
- daemon is TypeScript (`src/`), compiled to `dist/` in the Docker builder stage — `dist/` gitignored, nothing runs `src/*.ts` directly
- tests live in `tests/`, not `src/` — see `agent-archive.md`
- image build logs `✗ Failed to install plugin` for 3 community plugins — confirmed-harmless `tsup` DTS-only failure, JS still works. See `agent-archive.md`
- `POLL_INTERVAL` (plain seconds) paces the daemon's symlink check; `VAULT_SYNC_PERIOD` (a Go duration, e.g. `300s` — bare numbers fail) paces git-sync's own fetch — a build only fires when the symlink target changes
- issue #8 (non-root containers): `fsGroup` doesn't apply to `hostPath`, so a root `initContainer` chowns both volumes; git-sync needs `GITSYNC_ADD_USER=true` for SSH under its non-root UID, mounts the deploy key `0400` (`0644` is rejected by SSH), and sets `GITSYNC_SSH_KNOWN_HOSTS=false` since no known_hosts is mounted
- `build` is a required status check on `main`; CI must never skip the whole workflow (`paths-ignore`) or docs-only PRs deadlock waiting for `build` — instead a `changes` job gates the real work and `build` always reports
