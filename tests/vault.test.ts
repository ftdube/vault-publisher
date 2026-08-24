import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { readVaultCurrentRef } from "../src/vault.js"

// FR-BUILD-7: the daemon reads git-sync's current symlink to detect a vault change.
test("FR-BUILD-7: readVaultCurrentRef returns the symlink target when git-sync has synced", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vault-sync-"))
  try {
    const revDir = path.join(dir, "rev-abc123")
    mkdirSync(revDir)
    const linkPath = path.join(dir, "current")
    symlinkSync(revDir, linkPath)
    assert.equal(readVaultCurrentRef(linkPath), revDir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// FR-BUILD-7: must never throw before git-sync's first successful sync.
test("FR-BUILD-7: readVaultCurrentRef returns null when git-sync hasn't synced yet", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vault-sync-"))
  try {
    const linkPath = path.join(dir, "current")
    assert.equal(readVaultCurrentRef(linkPath), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
