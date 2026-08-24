# vault-publisher

Self-contained daemon that polls an Obsidian vault git repo, builds it as a static site with Quartz, and persists the output for a Caddy sidecar to serve. Designed for low-power k3s clusters.

## Hard rules

- Never bake vault content, personal domains, hostnames, or credentials into the image
- `VAULT_REPO_URL`, `QUARTZ_BASE_URL`, and SSH keys are injected at runtime via env vars / K8s Secrets
- `@jackyzha0/quartz` is a git-ref-pinned dependency (it is `private: true` upstream and not on the npm registry) — do not fork it; upgrades are a `package.json` ref bump
- Build output is written to a temp directory first, then atomically renamed to `/site` — never write directly to the live serve path mid-build

## Non-obvious gotchas

- quartz resolves `quartz.config.yaml` and its own build scripts relative to `process.cwd()`, not its install location — the daemon must run the build with cwd set to `node_modules/@jackyzha0/quartz` itself, with `quartz.config.yaml` copied there too; running from the app root fails
- quartz has no native PWA/manifest support (`shortName` etc.) — that was a patch in the old fork's `Head.tsx`; unpatched quartz can't honor it without violating the no-patch rule above
- `hostPath` for both `/vault` (git clone) and `/site` (built output) ties the Pod to one node — a `nodeSelector` is required; loss of that node means service loss
- On first-ever run `/site` is empty until the first build completes — Caddy will 404 during this window; subsequent pod restarts serve stale content immediately while the builder re-checks for changes
- quartz's node_modules must be in the image, not installed at runtime — keeps cold-start fast and removes npm registry dependency at pod startup
- the daemon is TypeScript (`src/`), compiled to `dist/` in the Docker builder stage (`npm run build`) — `dist/` is gitignored; there's nothing to run directly with `node src/daemon.ts`
- SSH deploy key for private vault repos must be mounted with `defaultMode: 0400`; the default K8s Secret volume mode (`0644`) is rejected by SSH
- `POLL_INTERVAL` governs how often `git fetch` is run, not how often builds happen — a build only fires when the remote HEAD differs from local HEAD
