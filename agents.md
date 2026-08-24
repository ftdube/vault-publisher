# vault-publisher

Self-contained daemon that polls an Obsidian vault git repo, builds it as a static site with Quartz, and persists the output for a Caddy sidecar to serve. Designed for low-power k3s clusters.

## Hard rules

- Never bake vault content, personal domains, hostnames, or credentials into the image
- `VAULT_REPO_URL`, `QUARTZ_BASE_URL`, and SSH keys are injected at runtime via env vars / K8s Secrets
- `@jackyzha0/quartz` is a git-ref-pinned dependency (`private: true`, not on the npm registry) — do not fork or patch it; upgrades are a `package.json` ref bump
- Build output is written to a temp directory first, then renamed to `/site` — never write directly to the live serve path mid-build

## Non-obvious gotchas

- quartz's build must run with cwd set to `node_modules/@jackyzha0/quartz` itself (config + build scripts resolve relative to `process.cwd()`) — running from the app root fails. See `agent-archive.md`
- quartz has no native PWA/manifest support — dropped rather than patching quartz (see `agent-archive.md`)
- `hostPath` for `/vault` and `/site` ties the Pod to one node — `nodeSelector` required; loss of that node means service loss
- `/site` is empty until the first build completes — Caddy 404s during that one-time window only
- quartz's `node_modules` is baked into the image, never installed at runtime — see `agent-archive.md`
- the daemon is TypeScript (`src/`), compiled to `dist/` in the Docker builder stage (`npm run build`) — `dist/` is gitignored, nothing runs `src/*.ts` directly
- tests live in `tests/`, not `src/` — see `agent-archive.md`
- SSH deploy key must be mounted `0400`; the default K8s Secret mode (`0644`) is rejected by SSH
- `POLL_INTERVAL` paces `git fetch`, not builds — a build only fires when the remote HEAD differs from local HEAD
