# vault-publisher

Daemon that builds an Obsidian vault as a static site with Quartz whenever a `git-sync` sidecar syncs a change, and persists the output for a Caddy sidecar to serve. Designed for low-power k3s clusters.

## Hard rules

- Never bake vault content, personal domains, hostnames, or credentials into the image
- `VAULT_REPO_URL`/`VAULT_BRANCH`/`SSH_KEY_PATH` are injected into the `git-sync` sidecar; `QUARTZ_BASE_URL`/`QUARTZ_PAGE_TITLE`/`POLL_INTERVAL` into the daemon — both via env vars / K8s Secrets
- `@jackyzha0/quartz` is a git-ref-pinned dependency (`private: true`, not on the npm registry) — do not fork or patch it; upgrades are a `package.json` ref bump
- Build output is written to a temp directory first, then renamed to `/site` — never write directly to the live serve path mid-build

## Non-obvious gotchas

- the daemon has no git code (`src/git.ts` deleted) — it only reads `/vault/current`, a symlink the `git-sync` sidecar maintains (BRD §9.2); `/vault` is mounted read-only by the daemon
- quartz's build must run with cwd set to `node_modules/@jackyzha0/quartz` itself (config + build scripts resolve relative to `process.cwd()`) — running from the app root fails. See `agent-archive.md`
- quartz has no native PWA/manifest support — dropped rather than patching quartz (see `agent-archive.md`)
- `hostPath` for `/vault` and `/site` ties the Pod to one node — `nodeSelector` required; loss of that node means service loss
- `/site` is empty until the first build completes — Caddy 404s during that one-time window only
- quartz's `node_modules` is baked into the image, never installed at runtime — see `agent-archive.md`
- the daemon is TypeScript (`src/`), compiled to `dist/` in the Docker builder stage (`npm run build`) — `dist/` is gitignored, nothing runs `src/*.ts` directly
- tests live in `tests/`, not `src/` — see `agent-archive.md`
- the image build logs `✗ Failed to install plugin` for `canvas-page`/`bases-page`/`note-properties` — confirmed harmless (a `tsup` DTS-generation-only failure); the plugins' JS still builds and works. See `agent-archive.md`
- SSH deploy key must be mounted `0400` into the `git-sync` container, not the daemon; the default K8s Secret mode (`0644`) is rejected by SSH
- `POLL_INTERVAL` paces the daemon's check of `/vault/current`, not a fetch — `git-sync`'s own `VAULT_SYNC_PERIOD` paces the actual fetch; a build only fires when the symlink target changes
