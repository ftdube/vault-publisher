import { readlinkSync } from "node:fs"

const VAULT_CURRENT_LINK = "/vault/current"

// FR-BUILD-7: /vault/current is a symlink the git-sync sidecar maintains, always
// pointing at the latest successfully synced checkout. Returns null (never throws)
// when git-sync hasn't completed its first sync yet.
export function readVaultCurrentRef(linkPath: string = VAULT_CURRENT_LINK): string | null {
  try {
    return readlinkSync(linkPath)
  } catch {
    return null
  }
}
