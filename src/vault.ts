import { realpathSync } from "node:fs"

const VAULT_CURRENT_LINK = "/vault/current"

// FR-BUILD-7: /vault/current is a symlink the git-sync sidecar maintains, always
// pointing at the latest successfully synced checkout. realpathSync resolves it to a
// concrete directory once, so the caller can pin a build to that snapshot — a live
// symlink instead re-resolves on every file access, which would let a build spanning
// a git-sync resync read a torn mix of two revisions. Returns null only for the
// expected pre-first-sync state (ENOENT); any other failure (bad permissions, a
// broken path) is a real misconfiguration and SHALL propagate, not read as "still waiting".
export function readVaultCurrentRef(linkPath: string = VAULT_CURRENT_LINK): string | null {
  try {
    return realpathSync(linkPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
    throw err
  }
}
