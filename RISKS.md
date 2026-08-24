# Risk Register — vault-publisher

Companion to [`BRD.md`](BRD.md).

| ID | Risk | Likelihood | Impact | Mitigation / Status |
|---|---|---|---|---|
| RISK-1 | `hostPath` ties the Pod to one node. If that node goes down, the site is unavailable until the node recovers — there is no automatic failover. | Low (RPi5 nodes are stable) | High (complete service loss) | Accepted for current single-user homelab; revisit if a third node is added and HA becomes viable. |
| RISK-2 | During the first-ever run, `/site` is empty until the first build completes. Caddy will 404 during this window. | Certain (one-time, first deploy only) | Low (brief, known window) | Document as expected behavior. Liveness probe should not use `/site/index.html` until after first build. |
| RISK-3 | A quartz upstream release may introduce a breaking change to `quartz.config.yaml` format or CLI flags, silently breaking builds. | Low | Medium | Pin quartz to a specific version in `package.json`; upgrade deliberately. CI build validates the image. |
| RISK-4 | SSH deploy key exposure. A misconfigured Secret volume (`0644` instead of `0400`) causes SSH to silently reject the key, not a security leak — but a misconfigured RBAC that grants broad Secret read access would expose the key to other cluster workloads. | Low | High | Mount with `defaultMode: 0400` (documented hard rule). Scope RBAC to the namespace. |
| RISK-5 | A long-running quartz build on RPi5 may time out, OOM-kill, or spike CPU enough to affect other workloads on the same node. | Medium (large vault) | Medium | Set resource `limits.memory` on the builder container. Monitor with `kubectl top`. If chronic, add a build concurrency lock. |
| RISK-6 | `/site-next` → `/site` rename is atomic at the filesystem level but `hostPath` does not guarantee the rename is visible to Caddy immediately (depends on OS and filesystem). | Very low (Linux rename is atomic) | High if it fails | Verified on Linux: `rename(2)` is atomic. Caddy reads directory entries on each request — no caching layer that could serve stale files from a replaced directory. |
| RISK-7 | The vault git repo becomes unreachable (network issue, SSH key rotation, repo moved). The daemon retries on the next poll cycle but cannot rebuild. | Low | Low (last build continues to be served) | Log fetch failures clearly. Add a Gatus check for the site so staleness is visible. |
