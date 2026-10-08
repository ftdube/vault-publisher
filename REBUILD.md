# Rebuild

From an empty workstation to a published site. This repository publishes an image; it applies nothing to a cluster. `deploy/k8s/` is a worked example to copy into your own cluster-config repository.

**Rehearsal status:** not rehearsed from this page. The local verification rig below was last run 2026-08-25 (`next-steps.md`); the manifests have never been applied to a live cluster.

## Inputs

| Input | Needed for | Where it lives |
|---|---|---|
| The vault's git repository URL | git-sync | Kubernetes Secret `vault-publisher-repo` |
| A read-only deploy key, and the git host's `known_hosts` | git-sync over SSH; skip for an HTTPS-public repo | Kubernetes Secret `vault-publisher-ssh-key` |
| A node with room for the two hostPath directories | The Pod, pinned by `nodeSelector` | Your cluster |
| The site's public base URL | `QUARTZ_BASE_URL` | `deploy/k8s/configmap.yaml` |

## Workstation

1. Clone the repository.
2. Install the Node version the `Dockerfile` builds on (`scripts/ci-node-matches-dockerfile.sh` enforces the match in CI), then `npm ci`.
3. `npm run typecheck` and `npm test`.
4. Optional, end to end: the `docker-compose.verify.yml` rig (usage in its header) runs git-sync → builder → Caddy against a throwaway sample vault.

## Deploy

Follow [README, "Configure and deploy"](README.md#configure-and-deploy), then ["Verify it's working"](README.md#verify-its-working). The non-root and SSH-key gotchas are in `AGENTS.md`.
