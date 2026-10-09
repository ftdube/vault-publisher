# vault-publisher

Daemon that builds an Obsidian vault as a static site with Quartz whenever a `git-sync` sidecar syncs a change, and persists the output for a Caddy sidecar to serve. Designed for low-power k3s clusters. Rebuild: [`REBUILD.md`](REBUILD.md).

## Hard rules

- Never bake vault content, personal domains, hostnames, or credentials into the image
- `VAULT_REPO_URL`/`VAULT_BRANCH`/`SSH_KEY_PATH` are injected into the `git-sync` sidecar; `QUARTZ_BASE_URL`/`QUARTZ_PAGE_TITLE`/`POLL_INTERVAL` into the daemon — both via env vars / K8s Secrets
- `@jackyzha0/quartz` is a git-ref-pinned dependency (`private: true`, not on the npm registry) — do not fork or patch it; upgrades are a `package.json` ref bump
- Build output is written to `/site/next`, then renamed to `/site/current` — never write directly to `/site/current` mid-build; never rename the `/site` mount point itself. Why: [`decisions.md`](decisions.md#site-itself-is-never-renamed-risk-6-issue-4)

## Non-obvious gotchas

- no git code in the daemon (`src/git.ts` deleted) — reads git-sync's `/vault/current` symlink only (BRD §9.2); `/vault` is read-only for the daemon
- quartz's build must run with cwd = `node_modules/@jackyzha0/quartz` (config/scripts resolve relative to `process.cwd()`, not install path). Why: [`decisions.md`](decisions.md#quartzs-build-runs-from-inside-its-package-directory)
- quartz has no native PWA/manifest support — dropped rather than patched. Why: [`decisions.md`](decisions.md#no-pwamanifest-support)
- `hostPath` for `/vault` and `/site` ties the Pod to one node — `nodeSelector` required; loss of that node means service loss
- Caddy's root MUST be `/site/current`, not `/site` (see the `/site` rule above)
- `/site/current` doesn't exist until the first build completes — Caddy 404s during that one-time window only
- quartz's `node_modules` and community plugins are pre-baked into the image, never installed/built at runtime. Why: [`decisions.md`](decisions.md#quartzs-node_modules-is-baked-into-the-image)
- tests live in `tests/`, not `src/`. Why: [`decisions.md`](decisions.md#tests-live-in-tests-not-beside-the-source)
- image build logs `✗ Failed to install plugin` for 3 community plugins — confirmed-harmless `tsup` DTS-only failure, JS still works. Why: [`decisions.md`](decisions.md#pre-built-plugins-failed-to-install-plugin-errors-are-harmless)
- `POLL_INTERVAL` (plain seconds) paces the daemon's symlink check; `VAULT_SYNC_PERIOD` (a Go duration, e.g. `300s` — bare numbers fail) paces git-sync's own fetch — a build only fires when the symlink target changes
- issue #8 (non-root containers): `fsGroup` doesn't apply to `hostPath`, so a root `initContainer` chowns both volumes; git-sync needs `GITSYNC_ADD_USER=true` for SSH under its non-root UID, mounts the deploy key `0400` (`0644` is rejected by SSH); Secret files are root-owned, so the pod's `fsGroup: 1000` is what lets git-sync read them; keep host-key checking on — `known_hosts` ships in the same Secret, never `GITSYNC_SSH_KNOWN_HOSTS=false`
- `build` is a required status check on `main`; CI must never skip the whole workflow (`paths-ignore`) or docs-only PRs deadlock waiting for `build` — instead a `changes` job gates the real work and `build` always reports

## Contributing

What an outside contributor must follow that CI does not enforce:

- Branch from `main` as `feature/<name>`, `fix/<name>` or `docs/<name>`, then open a pull request.
- Never commit secrets. CI's `secrets` job scans all of history, but by then a pushed secret is already public: rotate it, since rewriting history does not take it back.
- No personal identifiers (domains, hostnames, usernames, emails, IPs) or personal infrastructure in any file except the repository's ownership metadata (`.github/CODEOWNERS`, `LICENSE`); deployment specifics arrive through environment variables.
- Rationale goes in [`decisions.md`](decisions.md), linked from the rule it explains with `Why:`; deferred work in [`next-steps.md`](next-steps.md) with the condition that triggers it.
- One-time setup goes in [`REBUILD.md`](REBUILD.md). This file holds only hard rules and non-obvious gotchas, under 1,600 tokens (words × 1.33).
- Each fact lives in one file; link to it rather than copying it.
- Code comments only when the why is non-obvious; no multi-line docstrings.
